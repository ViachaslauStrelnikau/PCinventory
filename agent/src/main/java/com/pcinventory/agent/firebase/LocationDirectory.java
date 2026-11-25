package com.pcinventory.agent.firebase;

import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

public final class LocationDirectory {
    private final Map<String, Map<String, Set<String>>> buildings = new TreeMap<>();

    void add(String building, String floor, String room) {
        if (building.isEmpty() || floor.isEmpty() || room.isEmpty()
                || building.length() > 256 || floor.length() > 64 || room.length() > 64) {
            return;
        }
        buildings.computeIfAbsent(building, ignored -> new TreeMap<>())
                .computeIfAbsent(floor, ignored -> new TreeSet<>()).add(room);
    }

    public String[] buildings() {
        return buildings.keySet().toArray(new String[0]);
    }

    public String[] floors(String building) {
        Map<String, Set<String>> floors = building == null ? null : buildings.get(building);
        return floors == null ? new String[0] : floors.keySet().toArray(new String[0]);
    }

    public String[] rooms(String building, String floor) {
        Map<String, Set<String>> floors = building == null ? null : buildings.get(building);
        Set<String> rooms = floors == null || floor == null ? null : floors.get(floor);
        return rooms == null ? new String[0] : rooms.toArray(new String[0]);
    }
}
