package de.putzplan.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Eigenes Plugin für die Planta-Verbindung (muss vor super.onCreate registriert werden).
        registerPlugin(PlantaBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
