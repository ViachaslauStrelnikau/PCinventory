package com.pcinventory.agent.contract;

import com.fasterxml.jackson.annotation.JsonInclude;

public final class ComputerDocument extends Hardware {
    public String deviceId;
    public String floor;
    public String room;
    public String inventoryNumber;
    public String employeeName;
    public String department;
    public String building;
    public String comment;

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public Status status;
    public String lastReportId;
    public ContractTimestamp lastInventoryAt;
    public ContractTimestamp assignmentUpdatedAt;
    public String assignmentUpdatedBy;

    public enum Status { ACTIVE, RETIRED }
}
