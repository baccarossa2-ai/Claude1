package chat.cloudy.app;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Streaming HTTP for the web layer (app/src/platform/http.js).
 *
 * The WebView's fetch() is bound by CORS, and Cloudy's API only allows the
 * Content-Type header cross-origin — so an authenticated request never leaves
 * the page. This plugin makes the request natively and streams the body back
 * as "httpEvent" notifications (head → chunk… → end | error), which is what
 * lets SSE replies render token by token on the phone too.
 */
@CapacitorPlugin(name = "CloudyNative")
public class CloudyNativePlugin extends Plugin {
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> active = new ConcurrentHashMap<>();
    private final Set<String> aborted = ConcurrentHashMap.newKeySet();

    @PluginMethod
    public void httpStart(PluginCall call) {
        final String id = call.getString("id");
        final String url = call.getString("url");
        final String method = call.getString("method", "GET");
        final JSObject headers = call.getObject("headers", new JSObject());
        final String bodyBase64 = call.getString("bodyBase64");
        if (id == null || url == null) {
            call.reject("id e url sono obbligatori");
            return;
        }
        call.resolve();
        pool.execute(() -> run(id, url, method, headers, bodyBase64));
    }

    @PluginMethod
    public void httpAbort(PluginCall call) {
        String id = call.getString("id");
        if (id != null) {
            aborted.add(id);
            final HttpURLConnection conn = active.get(id);
            if (conn != null) pool.execute(conn::disconnect);
        }
        call.resolve();
    }

    private void emit(JSObject event) {
        notifyListeners("httpEvent", event);
    }

    /** HttpURLConnection refuses PATCH; set the method field directly when it does. */
    private static void setMethod(HttpURLConnection conn, String method) throws Exception {
        try {
            conn.setRequestMethod(method);
        } catch (java.net.ProtocolException e) {
            Class<?> c = conn.getClass();
            while (c != null) {
                try {
                    Field f = c.getDeclaredField("method");
                    f.setAccessible(true);
                    f.set(conn, method);
                    return;
                } catch (NoSuchFieldException ignored) {
                    c = c.getSuperclass();
                }
            }
            conn.setRequestMethod("POST");
            conn.setRequestProperty("X-HTTP-Method-Override", method);
        }
    }

    private void run(String id, String url, String method, JSObject headers, String bodyBase64) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            active.put(id, conn);
            setMethod(conn, method);
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(600000);
            conn.setInstanceFollowRedirects(true);
            conn.setUseCaches(false);
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                conn.setRequestProperty(k, headers.getString(k));
            }
            if (bodyBase64 != null && !method.equals("GET") && !method.equals("HEAD")) {
                byte[] body = Base64.decode(bodyBase64, Base64.DEFAULT);
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(body.length);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body);
                }
            }
            int status = conn.getResponseCode();
            JSObject head = new JSObject();
            head.put("id", id);
            head.put("type", "head");
            head.put("status", status);
            head.put("statusText", conn.getResponseMessage());
            head.put("url", conn.getURL().toString());
            JSObject hdrs = new JSObject();
            for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                if (e.getKey() == null) continue;
                hdrs.put(e.getKey().toLowerCase(), String.join(", ", e.getValue()));
            }
            head.put("headers", hdrs);
            emit(head);

            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (in != null) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (aborted.contains(id)) break;
                    JSObject chunk = new JSObject();
                    chunk.put("id", id);
                    chunk.put("type", "chunk");
                    chunk.put("base64", Base64.encodeToString(buf, 0, n, Base64.NO_WRAP));
                    emit(chunk);
                }
                in.close();
            }
            JSObject end = new JSObject();
            end.put("id", id);
            end.put("type", "end");
            emit(end);
        } catch (Exception e) {
            if (!aborted.contains(id)) {
                JSObject err = new JSObject();
                err.put("id", id);
                err.put("type", "error");
                err.put("message", e.getClass().getSimpleName() + ": " + e.getMessage());
                emit(err);
            }
        } finally {
            active.remove(id);
            aborted.remove(id);
            if (conn != null) conn.disconnect();
        }
    }
}
