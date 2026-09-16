package com.smartpet.senselab

import android.content.Context
import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BleForegroundServiceModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "BleForegroundService"

  @ReactMethod
  fun start(promise: Promise) {
    try {
      val context = reactApplicationContext
      val intent = Intent(context, BleForegroundService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BLE_FOREGROUND_SERVICE_START_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      val context = reactApplicationContext
      context.stopService(Intent(context, BleForegroundService::class.java))
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BLE_FOREGROUND_SERVICE_STOP_FAILED", error.message, error)
    }
  }
}
