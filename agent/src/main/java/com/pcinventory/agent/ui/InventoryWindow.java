package com.pcinventory.agent.ui;

import com.pcinventory.agent.collector.HardwareReport;
import com.pcinventory.agent.collector.HardwareSnapshot;
import com.pcinventory.agent.collector.HardwareSource;
import com.pcinventory.agent.contract.Assignment;
import com.pcinventory.agent.firebase.CollectorAccount;
import com.pcinventory.agent.firebase.FirebaseClient;
import com.pcinventory.agent.firebase.LocationDirectory;
import com.pcinventory.agent.firebase.SubmissionDraft;

import javax.swing.BorderFactory;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.DefaultComboBoxModel;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import javax.swing.SwingWorker;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.WindowConstants;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.text.AbstractDocument;
import javax.swing.text.AttributeSet;
import javax.swing.text.BadLocationException;
import javax.swing.text.DocumentFilter;
import javax.swing.text.JTextComponent;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.GridBagConstraints;
import java.awt.GraphicsEnvironment;
import java.awt.GridBagLayout;
import java.awt.GridLayout;
import java.awt.Insets;
import java.awt.Rectangle;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.util.Arrays;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutionException;

public final class InventoryWindow extends JFrame {
    private static final String BLANK = "[\\s\\p{Z}\\u0085\\ufeff]*";
    private final HardwarePanel hardware = new HardwarePanel();
    private final HardwareSource hardwareSource;
    private final JButton read = new JButton("Прочитать конфигурацию");
    private final JButton register = new JButton("Зарегистрировать");
    private final JTextField inventoryNumber = new JTextField(28);
    private final JTextField employeeName = new JTextField(28);
    private final JTextField department = new JTextField(28);
    private final JComboBox<String> buildings = editableLocation();
    private final JComboBox<String> floors = editableLocation();
    private final JComboBox<String> rooms = editableLocation();
    private final JTextComponent building = (JTextComponent) buildings.getEditor().getEditorComponent();
    private final JTextComponent floor = (JTextComponent) floors.getEditor().getEditorComponent();
    private final JTextComponent room = (JTextComponent) rooms.getEditor().getEditorComponent();
    private final JLabel directoryStatus = new JLabel();
    private final JTextArea comment = new JTextArea(3, 30);
    private final JTextField email = new JTextField(28);
    private final JPasswordField password = new JPasswordField(28);
    private final JTextComponent[] fields = {inventoryNumber, employeeName, department, building, floor, room,
            comment, email, password};
    private final JLabel status = new JLabel("Ожидание чтения конфигурации");
    private final ReadingSpinner spinner = new ReadingSpinner();
    private final Timer spinnerTimer = new Timer(80, event -> {
        spinner.advance();
        status.repaint();
    });
    private final boolean preview;
    private final FirebaseClient client;
    private final CollectorAccount account;
    private LocationDirectory directory = new LocationDirectory();
    private SwingWorker<LocationDirectory, Void> locationRequest;
    private boolean updatingLocations;
    private boolean locationUpdatePending;
    private HardwareSnapshot snapshot;
    private boolean busy;
    private SubmissionDraft draft;
    private String[] draftAssignment;
    private SwingWorker<FirebaseClient.Result, Void> submission;

    public InventoryWindow(HardwareSource hardwareSource, boolean preview, FirebaseClient client, CollectorAccount account) {
        super("Computer Inventory — Регистрация компьютера");
        this.hardwareSource = hardwareSource;
        this.preview = preview;
        this.client = client;
        this.account = account;
        setDefaultCloseOperation(WindowConstants.DISPOSE_ON_CLOSE);

        register.setEnabled(false);
        register.addActionListener(event -> register());
        read.addActionListener(event -> readConfiguration());
        JPanel actions = new JPanel(new GridLayout(1, 2, 8, 0));
        actions.add(read);
        actions.add(register);

        JPanel footer = new JPanel(new BorderLayout(0, 6));
        if (client != null && account == null) {
            JPanel operator = new JPanel(new GridBagLayout());
            operator.setBorder(BorderFactory.createTitledBorder("Локальный эмулятор · отчёт поступит на проверку"));
            addField(operator, 0, "Почта сборщика", email, 256);
            addField(operator, 1, "Пароль сборщика", password, 256);
            footer.add(operator, BorderLayout.PAGE_START);
        }
        listenForFormChanges();
        footer.add(actions, BorderLayout.CENTER);
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
            addWindowListener(new WindowAdapter() {
                @Override
                public void windowOpened(WindowEvent event) {
                    readConfiguration();
                }
            });
            if (account != null) loadLocations();
        }
    }

    private JPanel createAssignment() {
        JPanel assignment = new JPanel(new BorderLayout(0, 5));
        assignment.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createTitledBorder("Учётные данные"),
                BorderFactory.createEmptyBorder(2, 6, 6, 6)));
        JPanel fields = new JPanel(new GridBagLayout());
        addField(fields, 0, "Инвентарный номер", inventoryNumber, 256);
        addField(fields, 1, "ФИО сотрудника", employeeName, 256);
        addField(fields, 2, "Подразделение", department, 256);
        limitInput(building, 256);
        limitInput(floor, 64);
        limitInput(room, 64);
        addLabeledRow(fields, 3, "Здание / корпус *", buildings);

        JPanel location = new JPanel(new GridLayout(1, 2, 8, 0));
        location.add(locationField("Этаж *", floors));
        location.add(locationField("Кабинет *", rooms));

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
        if (account != null) mainFields.add(directoryStatus);
        assignment.add(mainFields, BorderLayout.PAGE_START);
        assignment.add(notes, BorderLayout.CENTER);
        return assignment;
    }

    private static JComboBox<String> editableLocation() {
        JComboBox<String> combo = new JComboBox<>();
        combo.setEditable(true);
        combo.setPrototypeDisplayValue("000000000000");
        return combo;
    }

    private static JPanel locationField(String name, JComboBox<String> field) {
        JLabel label = new JLabel(name);
        label.setLabelFor(field);
        JPanel panel = new JPanel(new BorderLayout(6, 0));
        panel.add(label, BorderLayout.LINE_START);
        panel.add(field, BorderLayout.CENTER);
        return panel;
    }

    private static void addField(JPanel panel, int row, String name, JTextComponent field, int limit) {
        limitInput(field, limit);
        addLabeledRow(panel, row, name, field);
    }

    static void addLabeledRow(JPanel panel, int row, String name, Component field) {
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
        if (busy) return;
        if (preview) {
            hardware.showPreview();
            showStatus("Демонстрационные данные. Регистрация недоступна.", true);
            return;
        }
        snapshot = null;
        draft = null;
        draftAssignment = null;
        setBusy(true);
        showStatus("Чтение конфигурации компьютера…", false);
        status.setIcon(spinner);
        spinnerTimer.start();
        new SwingWorker<HardwareSnapshot, Void>() {
            @Override
            protected HardwareSnapshot doInBackground() {
                return hardwareSource.read();
            }

            @Override
            protected void done() {
                try {
                    HardwareSnapshot result = get();
                    hardware.showProbe(result);
                    snapshot = result;
                    if (client != null) {
                        if (HardwareReport.canSubmit(result)) {
                            showStatus(account == null
                                    ? "Конфигурация прочитана. Укажите местоположение и данные сборщика."
                                    : "Конфигурация прочитана. Укажите местоположение.", true);
                        } else {
                            showStatus("Недостаточно данных для регистрации. Повторите чтение.", false);
                        }
                    } else if (result.warnings.isEmpty()) {
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
                    stopSpinner();
                    setBusy(false);
                }
            }
        }.execute();
    }

    @Override
    public void dispose() {
        if (submission != null) {
            submission.cancel(true);
        }
        if (locationRequest != null) locationRequest.cancel(true);
        if (account != null) account.clear();
        password.setText("");
        stopSpinner();
        super.dispose();
    }

    private void stopSpinner() {
        spinnerTimer.stop();
        status.setIcon(null);
    }

    private void listenForFormChanges() {
        DocumentListener listener = new DocumentListener() {
            @Override public void insertUpdate(DocumentEvent event) { changed(event); }
            @Override public void removeUpdate(DocumentEvent event) { changed(event); }
            @Override public void changedUpdate(DocumentEvent event) { changed(event); }

            private void changed(DocumentEvent event) {
                if (updatingLocations) return;
                updateRegisterButton();
                if (account != null && !locationUpdatePending
                        && (event.getDocument() == building.getDocument() || event.getDocument() == floor.getDocument())) {
                    locationUpdatePending = true;
                    SwingUtilities.invokeLater(() -> {
                        locationUpdatePending = false;
                        refreshLocationChoices();
                    });
                }
            }
        };
        for (JTextComponent field : fields) {
            field.getDocument().addDocumentListener(listener);
        }
    }

    private void loadLocations() {
        directoryStatus.setText("Загрузка справочника расположений…");
        locationRequest = new SwingWorker<LocationDirectory, Void>() {
            @Override
            protected LocationDirectory doInBackground() throws Exception {
                return client.loadLocations(account.email, account.passwordCopy());
            }

            @Override
            protected void done() {
                try {
                    directory = get();
                    refreshLocationChoices();
                    directoryStatus.setText(directory.buildings().length == 0
                            ? "Справочник пуст. Укажите расположение вручную."
                            : "Выберите расположение из справочника или введите вручную.");
                } catch (CancellationException ignored) {
                    // The window was closed.
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                } catch (ExecutionException exception) {
                    directoryStatus.setText("Справочник недоступен. Укажите расположение вручную.");
                } finally {
                    locationRequest = null;
                }
            }
        };
        locationRequest.execute();
    }

    private void refreshLocationChoices() {
        updatingLocations = true;
        try {
            replaceChoices(buildings, building, directory.buildings());
            replaceChoices(floors, floor, directory.floors(entry(building)));
            replaceChoices(rooms, room, directory.rooms(entry(building), entry(floor)));
        } finally {
            updatingLocations = false;
        }
        updateRegisterButton();
    }

    static void replaceChoices(JComboBox<String> combo, JTextComponent field, String[] choices) {
        int index = 0;
        while (index < choices.length && index < combo.getItemCount()
                && choices[index].equals(combo.getItemAt(index))) index++;
        if (index == choices.length && index == combo.getItemCount()) return;
        String text = field.getText();
        combo.setModel(new DefaultComboBoxModel<>(choices));
        combo.setSelectedItem(text);
        field.setText(text);
    }

    private void setBusy(boolean value) {
        busy = value;
        read.setEnabled(!busy);
        updateRegisterButton();
    }

    private static String entry(JTextComponent field) {
        String value = field.getText().trim();
        return value.matches(BLANK) ? null : value;
    }

    private String[] assignmentValues() {
        return new String[] {entry(building), entry(floor), entry(room), entry(inventoryNumber),
                entry(employeeName), entry(department), entry(comment)};
    }

    private void updateRegisterButton() {
        if (client == null || busy || snapshot == null || !HardwareReport.canSubmit(snapshot)) {
            register.setEnabled(false);
            return;
        }
        String[] values = assignmentValues();
        register.setEnabled(values[0] != null && values[1] != null && values[2] != null
                && (account != null || entry(email) != null && password.getDocument().getLength() > 0)
                && (draft == null || !draft.isSent() || !Arrays.equals(values, draftAssignment)));
    }

    private void register() {
        updateRegisterButton();
        if (!register.isEnabled()) {
            return;
        }
        String[] values = assignmentValues();
        if (draft == null || !Arrays.equals(values, draftAssignment)) {
            Assignment assignment = new Assignment();
            assignment.building = values[0];
            assignment.floor = values[1];
            assignment.room = values[2];
            assignment.inventoryNumber = values[3];
            assignment.employeeName = values[4];
            assignment.department = values[5];
            assignment.comment = values[6];
            draft = new SubmissionDraft(snapshot.deviceId, HardwareReport.from(snapshot), assignment);
            draftAssignment = values;
        }
        SubmissionDraft pending = draft;
        String collectorEmail = account == null ? entry(email) : account.email;
        char[] secret = account == null ? password.getPassword() : account.passwordCopy();
        setBusy(true);
        for (JTextComponent field : fields) {
            field.setEnabled(false);
        }
        setLocationEnabled(false);
        showStatus("Отправка отчёта на проверку…", false);
        status.setIcon(spinner);
        spinnerTimer.start();
        submission = new SwingWorker<FirebaseClient.Result, Void>() {
            @Override
            protected FirebaseClient.Result doInBackground() {
                return client.submit(pending, collectorEmail, secret);
            }

            @Override
            protected void done() {
                try {
                    showSubmissionResult(get(), pending.reportId());
                } catch (CancellationException exception) {
                    showStatus("Отправка прервана.", false);
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    showStatus("Отправка прервана.", false);
                } catch (ExecutionException exception) {
                    showStatus("Не удалось отправить отчёт.", false);
                } finally {
                    Arrays.fill(secret, '\0');
                    password.setText("");
                    for (JTextComponent field : fields) {
                        field.setEnabled(true);
                    }
                    setLocationEnabled(true);
                    submission = null;
                    stopSpinner();
                    setBusy(false);
                }
            }
        };
        submission.execute();
    }

    private void setLocationEnabled(boolean enabled) {
        buildings.setEnabled(enabled);
        floors.setEnabled(enabled);
        rooms.setEnabled(enabled);
    }

    private void showSubmissionResult(FirebaseClient.Result result, String reportId) {
        switch (result) {
            case SENT:
                showStatus("ОК. Отчёт отправлен на проверку администратору.", true);
                break;
            case INVALID_REPORT:
                showStatus("Отчёт не прошёл проверку. Проверьте учётные данные и повторите чтение.", false);
                break;
            case LOGIN_FAILED:
                showStatus("Не удалось войти с учётной записью сборщика.", false);
                break;
            case ACCESS_DENIED:
                showStatus("Отправка запрещена. Проверьте роль сборщика и открыт ли приём.", false);
                break;
            case NETWORK_ERROR:
                showStatus("Не удалось связаться с сервисом инвентаризации.", false);
                break;
            case UNCONFIRMED:
                showStatus("Не удалось подтвердить сохранение. ID отчёта " + reportId, false);
                break;
            case CANCELLED:
                showStatus("Отправка прервана.", false);
                break;
            default:
                throw new IllegalStateException("Unexpected submission result");
        }
    }
}
