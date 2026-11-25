package com.pcinventory.agent.collector;

public final class RuntimeProbe {
    public final String os;
    public final String javaVersion;
    public final String jvmArchitecture;

    private RuntimeProbe(String os, String javaVersion, String jvmArchitecture) {
        this.os = os;
        this.javaVersion = javaVersion;
        this.jvmArchitecture = jvmArchitecture;
    }

    public static RuntimeProbe read() {
        return new RuntimeProbe(
                System.getProperty("os.name") + " (" + System.getProperty("os.version") + ")",
                System.getProperty("java.version"),
                System.getProperty("os.arch"));
    }

    @Override
    public String toString() {
        return "JVM-reported OS: " + os + "\nJava: " + javaVersion + "\nJVM architecture: " + jvmArchitecture;
    }
}
