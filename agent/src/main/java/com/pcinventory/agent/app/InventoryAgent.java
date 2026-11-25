package com.pcinventory.agent.app;

import com.pcinventory.agent.collector.RuntimeProbe;
import com.pcinventory.agent.collector.HardwareSource;
import com.pcinventory.agent.collector.WindowsHardwareSource;
import com.pcinventory.agent.firebase.CollectorAccount;
import com.pcinventory.agent.firebase.FirebaseClient;
import com.pcinventory.agent.ui.InventoryWindow;

import javax.swing.SwingUtilities;
import javax.swing.UIManager;
import javax.swing.UnsupportedLookAndFeelException;
import java.io.IOException;

public final class InventoryAgent {
    private InventoryAgent() {
    }

    public static void main(String[] args) {
        if (args.length == 1 && "--probe".equals(args[0])) {
            System.out.println(RuntimeProbe.read());
            return;
        }
        HardwareSource hardware = new WindowsHardwareSource();
        if (args.length == 1 && "--hardware-probe".equals(args[0])) {
            hardware.read().diagnosticLines().forEach(System.out::println);
            return;
        }

        boolean preview = args.length == 1 && "--preview".equals(args[0]);
        boolean emulator = "1".equals(System.getenv("PCINVENTORY_EMULATOR"));
        CollectorAccount account = preview ? null : loadAccount(emulator);
        FirebaseClient client = account != null ? account.client : !preview && emulator ? new FirebaseClient() : null;
        SwingUtilities.invokeLater(() -> {
            try {
                UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
            } catch (ReflectiveOperationException | UnsupportedLookAndFeelException exception) {
                // Keep the default Swing look and feel if the system theme is unavailable.
            }
            new InventoryWindow(hardware, preview, client, account).setVisible(true);
        });
    }

    private static CollectorAccount loadAccount(boolean emulator) {
        try {
            return CollectorAccount.load(emulator);
        } catch (IOException | IllegalArgumentException exception) {
            System.err.println("Не удалось прочитать настройки сборщика.");
            return null;
        }
    }
}
