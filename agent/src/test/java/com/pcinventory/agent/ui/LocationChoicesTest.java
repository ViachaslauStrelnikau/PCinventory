package com.pcinventory.agent.ui;

import org.junit.jupiter.api.Test;

import javax.swing.JComboBox;
import javax.swing.SwingUtilities;
import javax.swing.text.JTextComponent;

import static org.junit.jupiter.api.Assertions.assertEquals;

class LocationChoicesTest {
    @Test
    void retainsTypingWhileChangingTheAvailableRooms() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            JComboBox<String> rooms = new JComboBox<>();
            rooms.setEditable(true);
            JTextComponent editor = (JTextComponent) rooms.getEditor().getEditorComponent();
            editor.setText("009");
            InventoryWindow.replaceChoices(rooms, editor, new String[]{"001", "010"});
            assertEquals("009", editor.getText());
            assertEquals("010", rooms.getItemAt(1));
            rooms.setSelectedIndex(1);
            assertEquals("010", editor.getText());
            InventoryWindow.replaceChoices(rooms, editor, new String[0]);
            assertEquals("010", editor.getText());
            assertEquals(0, rooms.getItemCount());
        });
    }
}
