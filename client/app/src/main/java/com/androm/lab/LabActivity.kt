package com.androm.lab

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowInsets
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import io.socket.client.Ack
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

class LabActivity : Activity() {
    private lateinit var endpoint: EditText
    private lateinit var token: EditText
    private lateinit var connect: Button
    private lateinit var send: Button
    private lateinit var status: TextView
    private lateinit var delivery: TextView
    private lateinit var picker: Spinner
    private lateinit var catalog: JSONArray
    private val handler = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder().retryOnConnectionFailure(false).build()
    private var session: Socket? = null
    private var attempt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setDecorFitsSystemWindows(false)
        setContentView(R.layout.activity_lab)
        findViewById<View>(R.id.page).setOnApplyWindowInsetsListener { view, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        endpoint = findViewById(R.id.endpoint)
        token = findViewById(R.id.token)
        connect = findViewById(R.id.connect)
        send = findViewById(R.id.send)
        status = findViewById(R.id.status)
        delivery = findViewById(R.id.delivery)
        picker = findViewById(R.id.scenario)
        val preview = findViewById<TextView>(R.id.preview)
        catalog = assets.open("scenarios.json").bufferedReader().use { JSONArray(it.readText()) }
        val names = (0 until catalog.length()).map { catalog.getJSONObject(it).getString("label") }
        picker.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, names)
        picker.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>, view: View?, position: Int, id: Long) {
                preview.text = catalog.getJSONObject(position).getJSONObject("sample").toString(2)
            }
            override fun onNothingSelected(parent: AdapterView<*>) = Unit
        }
        connect.setOnClickListener {
            if (session == null) openSession() else endSession("الجلسة مغلقة")
        }
        send.setOnClickListener { sendSelected() }
    }

    private fun openSession() {
        val uri = runCatching { URI(endpoint.text.toString().trim()) }.getOrNull()
        if (uri == null || uri.scheme != "wss" || uri.host == null || uri.userInfo != null ||
            uri.port == 0 || uri.port > 65535 || uri.rawPath !in listOf("", "/") ||
            uri.rawQuery != null || uri.rawFragment != null) {
            endpoint.error = "أدخل عنوانًا مثل wss://127.0.0.1:8443"
            return
        }
        val code = token.text.toString().trim()
        if (code.isBlank()) {
            token.error = "أدخل رمز الاقتران من خادم المختبر"
            return
        }
        val options = IO.Options.builder()
            .setForceNew(true).setReconnection(false).setTimeout(8000)
            .setTransports(arrayOf(WebSocket.NAME)).setAuth(mapOf("token" to code))
            .build().apply {
                callFactory = http
                webSocketFactory = http
            }
        val socket = IO.socket(uri, options)
        session = socket
        connect.text = "قطع الاتصال"
        endpoint.isEnabled = false
        token.isEnabled = false
        status.text = "جارٍ الاتصال…"
        delivery.text = ""
        // Guard callbacks from an earlier session after rotation or disconnection.
        socket.on(Socket.EVENT_CONNECT) {
            runOnUiThread {
                if (session === socket) {
                    status.text = "جلسة متصلة · " + socket.id()
                    send.isEnabled = true
                }
            }
        }
        socket.on(Socket.EVENT_CONNECT_ERROR) {
            runOnUiThread {
                if (session === socket) endSession("تعذّر الاتصال. افحص العنوان وشهادة المختبر ورمز الاقتران.")
            }
        }
        socket.on(Socket.EVENT_DISCONNECT) {
            runOnUiThread { if (session === socket) endSession("انقطع الاتصال بالخادم") }
        }
        socket.connect()
    }

    private fun sendSelected() {
        val socket = session ?: return
        if (!socket.connected()) return
        val id = catalog.getJSONObject(picker.selectedItemPosition).getString("id")
        val currentAttempt = ++attempt
        send.isEnabled = false
        delivery.text = "بانتظار إيصال الخادم…"
        val timeout = Runnable {
            if (session === socket && attempt == currentAttempt) {
                attempt++
                send.isEnabled = true
                delivery.text = "لم يصل إيصال. تحقّق من سجل اللوحة قبل تكرار الإرسال."
            }
        }
        handler.postDelayed(timeout, 6000)
        // Send only the scenario ID selected on this screen.
        socket.emit("sample", id, Ack { args ->
            val result = args.firstOrNull() as? JSONObject
            runOnUiThread {
                if (session === socket && attempt == currentAttempt) {
                    handler.removeCallbacks(timeout)
                    send.isEnabled = true
                    delivery.text = if (result?.optBoolean("ok") == true)
                        "إيصال الخادم · " + result.optString("eventId")
                    else "رفض الخادم العينة"
                }
            }
        })
    }

    private fun endSession(message: String) {
        handler.removeCallbacksAndMessages(null)
        val old = session
        session = null
        old?.off()
        old?.disconnect()
        connect.text = "اتصال"
        send.isEnabled = false
        token.isEnabled = true
        endpoint.isEnabled = true
        status.text = message
        delivery.text = ""
    }

    override fun onStop() {
        endSession("الجلسة مغلقة")
        super.onStop()
    }
}
