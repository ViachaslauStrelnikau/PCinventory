package com.pcinventory.agent.ui;

import com.pcinventory.agent.collector.WindowsHardwareProbe;

import javax.swing.BorderFactory;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import javax.swing.SwingWorker;
import javax.swing.WindowConstants;
import javax.swing.text.AbstractDocument;
import javax.swing.text.AttributeSet;
import javax.swing.text.BadLocationException;
import javax.swing.text.DocumentFilter;
import javax.swing.text.JTextComponent;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.GridBagConstraints;
import java.awt.GraphicsEnvironment;
import java.awt.GridBagLayout;
import java.awt.GridLayout;
import java.awt.Insets;
import java.awt.Rectangle;
import java.util.concurrent.ExecutionException;

public final class InventoryWindow extends JFrame {
    private final HardwarePanel hardware = new HardwarePanel();
    private final JButton read = new JButton("Прочитать конфигурацию");
    private final JLabel status = new JLabel("Ожидание чтения конфигурации");
    private final boolean preview;

    public InventoryWindow(boolean preview) {
        super("Computer Inventory — Регистрация компьютера");
        this.preview = preview;
        setDefaultCloseOperation(WindowConstants.DISPOSE_ON_CLOSE);

        JButton register = new JButton("Зарегистрировать");
        register.setEnabled(false);
        read.addActionListener(event -> readConfiguration());
        JPanel actions = new JPanel(new GridLayout(1, 2, 8, 0));
        actions.add(read);
        actions.add(register);

        JPanel footer = new JPanel(new BorderLayout(0, 6));
        footer.add(actions, BorderLayout.PAGE_START);
        status.setOpaque(true);
        status.setBorder(BorderFactory.createEmptyBorder(7, 8, 7, 8));
        footer.add(status, BorderLayout.PAGE_END);

        JScrollPane hardwareScroll = new JScrollPane(hardware);
        hardwareScroll.setBorder(BorderFactory.createTitledBorder("Конфигурация компьютера"));
        hardwareScroll.setPreferredSize(new Dimension(440, 325));
        hardwareScroll.getVerticalScrollBar().setUnitIncrement(16);

        JPanel content = new JPanel(new BorderLayout(0, 8));
        content.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
        content.add(hardwareScroll, BorderLayout.CENTER);
        JPanel bottom = new JPanel(new BorderLayout(0, 8));
        bottom.add(createAssignment(), BorderLayout.CENTER);
        bottom.add(footer, BorderLayout.PAGE_END);
        content.add(bottom, BorderLayout.PAGE_END);

        JScrollPane windowScroll = new JScrollPane(content);
        windowScroll.setBorder(BorderFactory.createEmptyBorder());
        windowScroll.getVerticalScrollBar().setUnitIncrement(16);
        setContentPane(windowScroll);
        Rectangle usable = GraphicsEnvironment.getLocalGraphicsEnvironment().getMaximumWindowBounds();
        setSize(Math.min(820, usable.width), Math.min(900, usable.height));
        setLocationRelativeTo(null);

        if (preview) {
            hardware.showPreview();
            showStatus("Демонстрационные данные. Регистрация недоступна.", true);
        } else {
            showStatus("Ожидание чтения конфигурации", false);
        }
    }

    private static JPanel createAssignment() {
        JPanel assignment = new JPanel(new BorderLayout(0, 5));
        assignment.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createTitledBorder("Учётные данные"),
                BorderFactory.createEmptyBorder(2, 6, 6, 6)));
        JPanel fields = new JPanel(new GridBagLayout());
        addField(fields, 0, "Инвентарный номер", 256);
        addField(fields, 1, "ФИО сотрудника", 256);
        addField(fields, 2, "Подразделение", 256);
        addField(fields, 3, "Здание / корпус", 256);

        JPanel location = new JPanel(new GridLayout(1, 2, 8, 0));
        location.add(locationField("Этаж *"));
        location.add(locationField("Кабинет *"));

        JTextArea comment = new JTextArea(3, 30);
        comment.setLineWrap(true);
        comment.setWrapStyleWord(true);
        limitInput(comment, 2000);
        JLabel commentLabel = new JLabel("Примечание");
        commentLabel.setLabelFor(comment);
        JPanel notes = new JPanel(new BorderLayout(0, 3));
        notes.add(commentLabel, BorderLayout.PAGE_START);
        notes.add(new JScrollPane(comment), BorderLayout.CENTER);
        notes.add(new JLabel("* Обязательные поля"), BorderLayout.PAGE_END);

        JPanel mainFields = new JPanel();
        mainFields.setLayout(new BoxLayout(mainFields, BoxLayout.Y_AXIS));
        mainFields.add(fields);
        mainFields.add(location);
        assignment.add(mainFields, BorderLayout.PAGE_START);
        assignment.add(notes, BorderLayout.CENTER);
        return assignment;
    }

    private static JPanel locationField(String name) {
        JTextField field = new JTextField(16);
        limitInput(field, 64);
        JLabel label = new JLabel(name);
        label.setLabelFor(field);
        JPanel panel = new JPanel(new BorderLayout(6, 0));
        panel.add(label, BorderLayout.LINE_START);
        panel.add(field, BorderLayout.CENTER);
        return panel;
    }

    private static void addField(JPanel panel, int row, String name, int limit) {
        JTextField field = new JTextField(28);
        limitInput(field, limit);
        addLabeledRow(panel, row, name, field);
    }

    static void addLabeledRow(JPanel panel, int row, String name, JTextComponent field) {
        JLabel label = new JLabel(name);
        label.setLabelFor(field);
        Dimension labelSize = label.getPreferredSize();
        label.setPreferredSize(new Dimension(Math.max(labelSize.width, 170), labelSize.height));
        GridBagConstraints placement = new GridBagConstraints();
        placement.gridy = row;
        placement.insets = new Insets(2, 0, 2, 8);
        placement.anchor = GridBagConstraints.LINE_START;
        panel.add(label, placement);
        placement.gridx = 1;
        placement.weightx = 1;
        placement.fill = GridBagConstraints.HORIZONTAL;
        panel.add(field, placement);
    }

    private static void limitInput(JTextComponent field, int limit) {
        ((AbstractDocument) field.getDocument()).setDocumentFilter(new DocumentFilter() {
            @Override
            public void insertString(FilterBypass bypass, int offset, String text, AttributeSet attributes)
                    throws BadLocationException {
                replace(bypass, offset, 0, text, attributes);
            }

            @Override
            public void replace(FilterBypass bypass, int offset, int length, String text, AttributeSet attributes)
                    throws BadLocationException {
                int replacementLength = text == null ? 0 : text.length();
                if (bypass.getDocument().getLength() - length + replacementLength <= limit) {
                    super.replace(bypass, offset, length, text, attributes);
                }
            }
        });
    }

    private void showStatus(String message, boolean complete) {
        status.setText(message);
        status.setBackground(complete ? new Color(225, 239, 226) : new Color(232, 237, 243));
        status.setForeground(complete ? new Color(34, 91, 46) : new Color(34, 52, 69));
    }

    private void readConfiguration() {
        if (preview) {
            hardware.showPreview();
            showStatus("Демонстрационные данные. Регистрация недоступна.", true);
            return;
        }
        read.setEnabled(false);
        showStatus("Чтение конфигурации компьютера…", false);
        new SwingWorker<WindowsHardwareProbe, Void>() {
            @Override
            protected WindowsHardwareProbe doInBackground() {
                return WindowsHardwareProbe.read();
            }

            @Override
            protected void done() {
                try {
                    WindowsHardwareProbe result = get();
                    hardware.showProbe(result);
                    if (result.warnings.isEmpty()) {
                        showStatus("Чтение завершено. Регистрация в испытательной сборке недоступна.", true);
                    } else {
                        showStatus("Часть сведений недоступна. Подробности в блоке конфигурации.", false);
                    }
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    showStatus("Чтение прервано.", false);
                } catch (ExecutionException exception) {
                    showStatus("Не удалось прочитать конфигурацию. Попробуйте ещё раз.", false);
                } finally {
                    read.setEnabled(true);
                }
            }
        }.execute();
    }
}
