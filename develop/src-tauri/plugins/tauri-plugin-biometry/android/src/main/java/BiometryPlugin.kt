
package app.tauri.biometry

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.EnumMap
import java.util.HashMap
import kotlin.math.max
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.InvalidKeyException
import java.security.KeyStore
import java.util.concurrent.Executor
import javax.crypto.Cipher
import javax.crypto.BadPaddingException
import javax.crypto.IllegalBlockSizeException
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import android.content.Context

enum class BiometryResultType {
    SUCCESS, FAILURE, ERROR
}

private const val MAX_ATTEMPTS = "maxAttemps"
private const val BIOMETRIC_FAILURE = "authenticationFailed"
private const val INVALID_CONTEXT_ERROR = "invalidContext"

@InvokeArg
class AuthOptions {
    lateinit var reason: String
    var allowDeviceCredential: Boolean = false
    var title: String? = null
    var subtitle: String? = null
    var cancelTitle: String? = null
    var confirmationRequired: Boolean? = null
    var maxAttemps: Int = 3
}

@InvokeArg
class DataOptions {
    lateinit var domain: String
    lateinit var name: String
}

@InvokeArg
class SetDataOptions {
    lateinit var domain: String
    lateinit var name: String
    lateinit var data: String
}

@InvokeArg
class GetDataOptions {
    lateinit var domain: String
    lateinit var name: String
    var title: String? = null
    var subtitle: String? = null
    lateinit var reason: String
    var cancelTitle: String? = null
}

@InvokeArg
class RemoveDataOptions {
    lateinit var name: String
    lateinit var domain: String
}

// Extension property to create DataStore instance
private val Context.biometricDataStore: DataStore<Preferences> by preferencesDataStore(name = "biometric_data")

@TauriPlugin
class BiometryPlugin(private val activity: Activity): Plugin(activity) {
    private var biometryTypes: ArrayList<BiometryType> = arrayListOf()
    private val dataStore: DataStore<Preferences> = activity.biometricDataStore
    private val coroutineScope = CoroutineScope(Dispatchers.IO)

    companion object {
        var RESULT_EXTRA_PREFIX = ""
        const val TITLE = "title"
        const val SUBTITLE = "subtitle"
        const val REASON = "reason"
        const val CANCEL_TITLE = "cancelTitle"
        const val RESULT_TYPE = "type"
        const val RESULT_ERROR_CODE = "errorCode"
        const val RESULT_ERROR_MESSAGE = "errorMessage"
        const val DEVICE_CREDENTIAL = "allowDeviceCredential"
        const val CONFIRMATION_REQUIRED = "confirmationRequired"
        
        private const val AES_CIPHER_CONFIG = "AES/GCM/NoPadding"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val AES_KEY_SIZE = 256
        private const val GCM_TAG_LENGTH = 128

        // Maps biometry error numbers to string error codes
        private var biometryErrorCodeMap: MutableMap<Int, String> = HashMap()
        private var biometryNameMap: MutableMap<BiometryType, String> = EnumMap(BiometryType::class.java)

       init {
           biometryErrorCodeMap[BiometricManager.BIOMETRIC_SUCCESS] = ""
           biometryErrorCodeMap[BiometricManager.BIOMETRIC_SUCCESS] = ""
           biometryErrorCodeMap[BiometricPrompt.ERROR_CANCELED] = "systemCancel"
           biometryErrorCodeMap[BiometricPrompt.ERROR_HW_NOT_PRESENT] = "biometryNotAvailable"
           biometryErrorCodeMap[BiometricPrompt.ERROR_HW_UNAVAILABLE] = "biometryNotAvailable"
           biometryErrorCodeMap[BiometricPrompt.ERROR_LOCKOUT] = "biometryLockout"
           biometryErrorCodeMap[BiometricPrompt.ERROR_LOCKOUT_PERMANENT] = "biometryLockout"
           biometryErrorCodeMap[BiometricPrompt.ERROR_NEGATIVE_BUTTON] = "userCancel"
           biometryErrorCodeMap[BiometricPrompt.ERROR_NO_BIOMETRICS] = "biometryNotEnrolled"
           biometryErrorCodeMap[BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL] = "noDeviceCredential"
           biometryErrorCodeMap[BiometricPrompt.ERROR_NO_SPACE] = "systemCancel"
           biometryErrorCodeMap[BiometricPrompt.ERROR_TIMEOUT] = "systemCancel"
           biometryErrorCodeMap[BiometricPrompt.ERROR_UNABLE_TO_PROCESS] = "systemCancel"
           biometryErrorCodeMap[BiometricPrompt.ERROR_USER_CANCELED] = "userCancel"
           biometryErrorCodeMap[BiometricPrompt.ERROR_VENDOR] = "systemCancel"

           biometryNameMap[BiometryType.NONE] = "No Authentication"
           biometryNameMap[BiometryType.FINGERPRINT] = "Fingerprint Authentication"
           biometryNameMap[BiometryType.FACE] = "Face Authentication"
           biometryNameMap[BiometryType.IRIS] = "Iris Authentication"
       }
    }

    override fun load(webView: WebView) {
        super.load(webView)

        biometryTypes = ArrayList()
        val manager = activity.packageManager
        if (manager.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT)) {
            biometryTypes.add(BiometryType.FINGERPRINT)
        }
        if (manager.hasSystemFeature(PackageManager.FEATURE_FACE)) {
            biometryTypes.add(BiometryType.FACE)
        }
        if (manager.hasSystemFeature(PackageManager.FEATURE_IRIS)) {
            biometryTypes.add(BiometryType.IRIS)
        }
        if (biometryTypes.size == 0) {
            biometryTypes.add(BiometryType.NONE)
        }
    }

    /**
     * Check the device's availability and type of biometric authentication.
     */
    @Command
    fun status(invoke: Invoke) {
        val manager = BiometricManager.from(activity)
        val biometryResult = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
        } else {
            @Suppress("DEPRECATION")
            manager.canAuthenticate()
        }
        val ret = JSObject()

        val available = biometryResult == BiometricManager.BIOMETRIC_SUCCESS
        ret.put(
            "isAvailable",
            available
        )

        ret.put("biometryType", biometryTypes[0].type)

        if (!available) {
            var reason = ""
            when (biometryResult) {
                BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> reason =
                    "Biometry unavailable."
                BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> reason =
                    "Biometrics not enrolled."
                BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> reason =
                    "No biometric on this device."
                BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> reason =
                    "A security update is required."
                BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED -> reason =
                    "Unsupported biometry."
                BiometricManager.BIOMETRIC_STATUS_UNKNOWN -> reason =
                    "Unknown biometry state."
            }

            var errorCode = biometryErrorCodeMap[biometryResult]
            if (errorCode == null) {
                errorCode = "biometryNotAvailable"
            }
            ret.put("error", reason)
            ret.put("errorCode", errorCode)
        }

        invoke.resolve(ret)
    }

    /**
     * Prompt the user for biometric authentication.
     */
    @Command
    fun authenticate(invoke: Invoke) {
        // The result of an intent is supposed to have the package name as a prefix
        RESULT_EXTRA_PREFIX = activity.packageName + "."
        val intent = Intent(
            activity,
            BiometryActivity::class.java
        )
        
        val args = invoke.parseArgs(AuthOptions::class.java)

        // Pass the options to the activity
        intent.putExtra(
            TITLE,
            args.title ?: (biometryNameMap[biometryTypes[0]] ?: "")
        )
        intent.putExtra(SUBTITLE, args.subtitle)
        intent.putExtra(REASON, args.reason)
        intent.putExtra(CANCEL_TITLE, args.cancelTitle)
        intent.putExtra(DEVICE_CREDENTIAL, args.allowDeviceCredential)
        args.confirmationRequired?.let {
            intent.putExtra(CONFIRMATION_REQUIRED, it)
        }

        val maxAttemptsConfig = args.maxAttemps
        val maxAttempts = max(maxAttemptsConfig, 1)
        intent.putExtra(MAX_ATTEMPTS, maxAttempts)
        startActivityForResult(invoke, intent, "authenticateResult")
    }

    @ActivityCallback
    private fun authenticateResult(invoke: Invoke, result: ActivityResult) {
        val resultCode = result.resultCode

        // If the system canceled the activity, we might get RESULT_CANCELED in resultCode.
        // In that case return that immediately, because there won't be any data.
        if (resultCode == Activity.RESULT_CANCELED) {
            invoke.reject(
                "The system canceled authentication",
                biometryErrorCodeMap[BiometricPrompt.ERROR_CANCELED]
            )
            return
        }

        // Convert the string result type to an enum
        val data = result.data
        val resultTypeName = data?.getStringExtra(
            RESULT_EXTRA_PREFIX + RESULT_TYPE
        )
        if (resultTypeName == null) {
            invoke.reject(
                "Missing data in the result of the activity",
                INVALID_CONTEXT_ERROR
            )
            return
        }
        val resultType = try {
            BiometryResultType.valueOf(resultTypeName)
        } catch (e: IllegalArgumentException) {
            invoke.reject(
                "Invalid data in the result of the activity",
                INVALID_CONTEXT_ERROR
            )
            return
        }
        val errorCode = data.getIntExtra(
            RESULT_EXTRA_PREFIX + RESULT_ERROR_CODE,
            0
        )
        var errorMessage = data.getStringExtra(
            RESULT_EXTRA_PREFIX + RESULT_ERROR_MESSAGE
        )
        when (resultType) {
            BiometryResultType.SUCCESS -> invoke.resolve()
            BiometryResultType.FAILURE ->         // Biometry was successfully presented but was not recognized
                invoke.reject(errorMessage, BIOMETRIC_FAILURE)

            BiometryResultType.ERROR -> {
                // The user cancelled, the system cancelled, or some error occurred.
                // If the user cancelled, errorMessage is the text of the "negative" button,
                // which is not especially descriptive.
                if (errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON) {
                    errorMessage = "Cancel button was pressed"
                }
                invoke.reject(errorMessage, biometryErrorCodeMap[errorCode])
            }
        }
    }

    internal enum class BiometryType(val type: Int) {
        NONE(0), FINGERPRINT(1), FACE(2), IRIS(3);
    }
    
    /**
     * 生成受生物认证保护的 AES-256-GCM 密钥（存放于 Android Keystore）。
     *
     * 参照 Aegis 的实现：不使用 RSA。RSA-4096 密钥对在 Keystore 中生成需 1~3 秒，
     * 是「启用生物识别」明显卡顿的根因；AES-256 密钥由系统 Keymaster 瞬时生成，
     * 且原生支持与 BiometricPrompt.CryptoObject 绑定做「每次使用都需认证」。
     */
    private fun generateSecretKey(keyName: String): SecretKey {
        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            ANDROID_KEYSTORE
        )
        val builder = KeyGenParameterSpec.Builder(
            keyName,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(AES_KEY_SIZE)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)

        keyGenerator.init(builder.build())
        return keyGenerator.generateKey()
    }

    /** 读取 Keystore 中的密钥；非 AES 密钥（如旧版残留的 RSA）或已失效时返回 null */
    private fun getSecretKey(keyName: String): SecretKey? {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)
        if (!keyStore.containsAlias(keyName)) return null

        val key = try {
            keyStore.getKey(keyName, null)
        } catch (e: Exception) {
            // UnrecoverableKeyException：密钥已被永久失效（例如新增了指纹）
            return null
        }
        if (key !is SecretKey) return null

        // 试探性初始化一个 Cipher，检测密钥是否已被生物识别变更永久失效。
        //
        // 关键：必须只把 KeyPermanentlyInvalidatedException 判定为「失效」。
        // 该密钥受 setUserAuthenticationRequired(true) 保护，每次使用都需认证，
        // 因此未认证时 init() 会抛 UserNotAuthenticatedException —— 它的父类
        // 同样是 InvalidKeyException。若笼统地按 InvalidKeyException 判定失效，
        // 会把「密钥完好、只是当前未认证」误判为失效（用户表现为：刚进应用
        // 指纹可用、放一会儿后按钮变灰且不弹框，重启应用又恢复）。
        // KeyPermanentlyInvalidatedException 会在 init() 时先于认证检查抛出，
        // 故两个 catch 分支的先后顺序不影响结果。
        return try {
            val cipher = Cipher.getInstance(AES_CIPHER_CONFIG)
            cipher.init(Cipher.ENCRYPT_MODE, key)
            key
        } catch (e: KeyPermanentlyInvalidatedException) {
            null
        } catch (e: InvalidKeyException) {
            // UserNotAuthenticatedException 等：密钥仍有效，只是本次尚未认证
            key
        }
    }

    @Command
    fun hasData(invoke: Invoke) {
        val args = invoke.parseArgs(DataOptions::class.java)

        coroutineScope.launch {
            try {
                val key = stringPreferencesKey(args.name)
                val hasStoredData = dataStore.data
                    .map { preferences -> preferences.contains(key) }
                    .first()

                // 同时校验 Keystore 密钥仍可用：若密钥已因「新增指纹/面容」等原因
                // 被永久失效，则即便 DataStore 里还有密文，也必然无法解密。
                // 此时返回 false，让前端不再展示/自动唤起指纹，避免「指纹点了没反应、
                // 只能输密码」的死路（用户重新开启生物识别即可重新绑定）。
                val usable = if (hasStoredData) getSecretKey(args.domain) != null else false
                if (hasStoredData && !usable) {
                    // 顺手清理失效的凭据，避免残留导致后续判断继续出错
                    dataStore.edit { preferences ->
                        preferences.remove(key)
                        preferences.remove(stringPreferencesKey("${args.name}_iv"))
                        preferences.remove(stringPreferencesKey("${args.name}_key"))
                    }
                    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
                    keyStore.load(null)
                    keyStore.deleteEntry(args.domain)
                }

                val result = JSObject()
                result.put("hasData", usable)
                invoke.resolve(result)
            } catch (e: Exception) {
                invoke.reject("Failed to check data: ${e.message}")
            }
        }
    }

    @Command
    fun setData(invoke: Invoke) {
        val args = invoke.parseArgs(SetDataOptions::class.java)

        try {
            // 删除同别名下的旧条目（可能残留旧版 RSA 密钥），确保后续重绑定干净
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
            keyStore.load(null)
            if (keyStore.containsAlias(args.domain)) {
                keyStore.deleteEntry(args.domain)
            }

            // 生成受认证保护的 AES-256-GCM 密钥（瞬时完成）
            val secretKey = generateSecretKey(args.domain)

            // 用该密钥初始化加密 Cipher，并以 CryptoObject 形式绑定到认证提示，
            // 使「写入」这一步也需要指纹/面容授权（密钥在 Keystore 内受认证保护）。
            val encryptCipher = Cipher.getInstance(AES_CIPHER_CONFIG)
            encryptCipher.init(Cipher.ENCRYPT_MODE, secretKey)

            val promptInfo = BiometricPrompt.PromptInfo.Builder()
                .setTitle(biometryNameMap[biometryTypes[0]] ?: "")
                .setDescription("验证身份以绑定生物识别解锁")
                .setNegativeButtonText("取消")
                .build()

            val executor: Executor = ContextCompat.getMainExecutor(activity)
            val biometricPrompt = BiometricPrompt(
                activity as FragmentActivity,
                executor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(
                        result: BiometricPrompt.AuthenticationResult
                    ) {
                        super.onAuthenticationSucceeded(result)
                        coroutineScope.launch {
                            try {
                                val cipher = result.cryptoObject?.cipher
                                    ?: throw Exception("Cipher is null")
                                // GCM 随机 IV 由 Cipher 在 init 后生成，随密文一并保存
                                val iv = cipher.iv
                                val encryptedData = cipher.doFinal(args.data.toByteArray())

                                val dataKey = stringPreferencesKey(args.name)
                                val ivKey = stringPreferencesKey("${args.name}_iv")
                                dataStore.edit { preferences ->
                                    preferences[dataKey] =
                                        Base64.encodeToString(encryptedData, Base64.DEFAULT)
                                    preferences[ivKey] =
                                        Base64.encodeToString(iv, Base64.DEFAULT)
                                    // 清理旧版可能残留的 RSA 包裹字段
                                    preferences.remove(stringPreferencesKey("${args.name}_key"))
                                }
                                invoke.resolve()
                            } catch (e: Exception) {
                                invoke.reject("Failed to encrypt data: ${e.message}")
                            }
                        }
                    }

                    override fun onAuthenticationError(
                        errorCode: Int,
                        errString: CharSequence
                    ) {
                        super.onAuthenticationError(errorCode, errString)
                        invoke.reject(errString.toString(), biometryErrorCodeMap[errorCode])
                    }

                    override fun onAuthenticationFailed() {
                        super.onAuthenticationFailed()
                        // 允许用户重试，不在此处 reject
                    }
                }
            )

            biometricPrompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(encryptCipher))
        } catch (e: Exception) {
            invoke.reject("Failed to set data: ${e.message}")
        }
    }

    @Command
    fun getData(invoke: Invoke) {
        val args = invoke.parseArgs(GetDataOptions::class.java)

        try {
            val secretKey = getSecretKey(args.domain)
            if (secretKey == null) {
                invoke.reject("No key found", "biometryNotEnrolled")
                return
            }

            val dataKey = stringPreferencesKey(args.name)
            val ivKey = stringPreferencesKey("${args.name}_iv")
            val preferences = runBlocking { dataStore.data.first() }
            val ivString = preferences[ivKey]
            if (ivString == null) {
                invoke.reject("No IV found")
                return
            }
            val iv = Base64.decode(ivString, Base64.DEFAULT)

            // 用 AES 密钥 + 已存 IV 初始化解密 Cipher，绑定到认证提示：
            // 认证通过后拿到同一个 Cipher 完成解密。
            val decryptCipher = Cipher.getInstance(AES_CIPHER_CONFIG)
            decryptCipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_LENGTH, iv))

            val promptInfo = BiometricPrompt.PromptInfo.Builder()
                .setTitle(args.title ?: (biometryNameMap[biometryTypes[0]] ?: ""))
                .setSubtitle(args.subtitle)
                .setDescription(args.reason)
                // 注意：默认值必须是可读文案。此处曾误写为字面量 "cancelTitle"，
                // 而前端未传该字段，导致系统弹窗按钮直接显示 "cancelTitle"。
                .setNegativeButtonText(args.cancelTitle ?: "取消")
                .build()

            val executor: Executor = ContextCompat.getMainExecutor(activity)

            val biometricPrompt = BiometricPrompt(
                activity as FragmentActivity,
                executor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(
                        result: BiometricPrompt.AuthenticationResult
                    ) {
                        super.onAuthenticationSucceeded(result)

                        coroutineScope.launch {
                            try {
                                val cipher = result.cryptoObject?.cipher
                                    ?: throw Exception("Cipher is null")

                                val prefs = dataStore.data.first()
                                val encryptedData = prefs[dataKey]
                                    ?: throw Exception("No data found")

                                val decryptedBytes = cipher.doFinal(
                                    Base64.decode(encryptedData, Base64.DEFAULT)
                                )

                                val resultObject = JSObject()
                                resultObject.put("domain", args.domain)
                                resultObject.put("name", args.name)
                                resultObject.put("data", String(decryptedBytes))
                                invoke.resolve(resultObject)
                            } catch (e: BadPaddingException) {
                                invoke.reject("Decryption failed (BadPadding) - likely wrong key or cipher config")
                            } catch (e: IllegalBlockSizeException) {
                                invoke.reject("Decryption failed (IllegalBlockSize) - likely wrong key or cipher config")
                            } catch (e: Exception) {
                                invoke.reject("Failed to decrypt data: ${e.message}")
                            }
                        }
                    }

                    override fun onAuthenticationError(
                        errorCode: Int,
                        errString: CharSequence
                    ) {
                        super.onAuthenticationError(errorCode, errString)
                        invoke.reject(errString.toString(), biometryErrorCodeMap[errorCode])
                    }

                    override fun onAuthenticationFailed() {
                        super.onAuthenticationFailed()
                        // Don't reject here, let the user retry
                    }
                }
            )

            biometricPrompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(decryptCipher))
        } catch (e: Exception) {
            invoke.reject("Failed to get data: ${e.message}")
        }
    }

    @Command
    fun removeData(invoke: Invoke) {
        val args = invoke.parseArgs(RemoveDataOptions::class.java)
        
        coroutineScope.launch {
            try {
                val dataKey = stringPreferencesKey(args.name)
                val ivKey = stringPreferencesKey("${args.name}_iv")
                val aesKey = stringPreferencesKey("${args.name}_key")
                
                dataStore.edit { preferences ->
                    preferences.remove(dataKey)
                    preferences.remove(ivKey)
                    preferences.remove(aesKey)
                }
                
                // Delete the key from keystore
                val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
                keyStore.load(null)
                keyStore.deleteEntry(args.domain)
                
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject("Failed to remove data: ${e.message}")
            }
        }
    }
}
