package com.pcinventory.agent.contract;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public final class Assignment {
    public String floor;
    public String room;
    public String inventoryNumber;
    public String employeeName;
    public String department;
    public String building;
    public String comment;
}
