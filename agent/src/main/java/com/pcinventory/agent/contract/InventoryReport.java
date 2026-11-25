package com.pcinventory.agent.contract;

import com.fasterxml.jackson.annotation.JsonInclude;

public final class InventoryReport {
    public String reportId;
    public String deviceId;
    public Hardware hardware;
    public Assignment assignment;
    public ContractTimestamp submittedAt;
    public String submittedBy;
    public Status status;
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public ContractTimestamp reviewedAt;
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public String reviewedBy;

    public enum Status { PENDING, ACCEPTED, REJECTED }
}
