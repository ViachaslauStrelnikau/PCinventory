package com.pcinventory.agent.contract;

public final class ContractTimestamp {
    public long seconds;
    public int nanoseconds;

    boolean isBefore(ContractTimestamp other) {
        return seconds < other.seconds || (seconds == other.seconds && nanoseconds < other.nanoseconds);
    }
}
