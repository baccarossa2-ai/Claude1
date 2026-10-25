package chat.cloudy.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Our own plugin (streaming HTTP) must be registered before the bridge starts.
        registerPlugin(CloudyNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
