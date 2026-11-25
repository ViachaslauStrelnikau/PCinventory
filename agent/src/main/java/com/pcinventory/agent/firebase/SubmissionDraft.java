package com.pcinventory.agent.firebase;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.pcinventory.agent.contract.Assignment;
import com.pcinventory.agent.contract.ContractTimestamp;
import com.pcinventory.agent.contract.Hardware;
import com.pcinventory.agent.contract.InventoryContract;
import com.pcinventory.agent.contract.InventoryReport;

import java.io.IOException;
import java.util.UUID;

public final class SubmissionDraft {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final ObjectNode template;
    private final String reportId;
    private String submittedBy;
    private boolean unconfirmed;
    private boolean sent;

    public SubmissionDraft(String deviceId, Hardware hardware, Assignment assignment) {
        reportId = UUID.randomUUID().toString();
        InventoryReport report = new InventoryReport();
        report.reportId = reportId;
        report.deviceId = deviceId;
        report.hardware = hardware;
        report.assignment = assignment;
        report.status = InventoryReport.Status.PENDING;
        // This placeholder is validated locally and removed before the server timestamp transform.
        report.submittedAt = new ContractTimestamp();
        template = JSON.valueToTree(report);
    }

    public String reportId() {
        return reportId;
    }

    public boolean isSent() {
        return sent;
    }

    boolean hasUnconfirmedWrite() {
        return unconfirmed;
    }

    void markUnconfirmed() {
        unconfirmed = true;
    }

    void markSent() {
        sent = true;
        unconfirmed = false;
    }

    boolean acceptsUser(String uid) {
        return !unconfirmed || uid.equals(submittedBy);
    }

    void validate() throws IOException {
        validatedFields("validation");
    }

    ObjectNode pendingFields(String uid) throws IOException {
        ObjectNode fields = validatedFields(uid);
        submittedBy = uid;
        fields.remove("submittedAt");
        return fields;
    }

    private ObjectNode validatedFields(String uid) throws IOException {
        ObjectNode fields = template.deepCopy().put("submittedBy", uid);
        InventoryContract.readReport(JSON.writeValueAsBytes(fields));
        return fields;
    }
}
