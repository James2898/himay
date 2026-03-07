import React, { useState, useEffect } from "react";

const DebugConsole: React.FC = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const originalLog = console.log;
    const originalError = console.error;

    // Override console.log
    console.log = (...args) => {
      setLogs((prev) => [...prev.slice(-10), `LOG: ${args.join(" ")}`]);
      originalLog(...args);
    };

    // Override console.error
    console.error = (...args) => {
      setLogs((prev) => [...prev.slice(-10), `ERR: ${args.join(" ")}`]);
      originalError(...args);
    };

    return () => {
      console.log = originalLog;
      console.error = originalError;
    };
  }, []);

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        style={{
          position: "fixed",
          bottom: 10,
          left: 10,
          zIndex: 9999,
          opacity: 0.5,
          fontSize: "10px",
        }}
      >
        DEBUG
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: "150px",
        background: "rgba(0,0,0,0.9)",
        color: "#00ff00",
        fontSize: "10px",
        fontFamily: "monospace",
        overflowY: "auto",
        zIndex: 9999,
        padding: "10px",
        borderTop: "1px solid #00ff00",
      }}
    >
      <button onClick={() => setIsVisible(false)} style={{ float: "right" }}>
        CLOSE
      </button>
      <button
        onClick={() => setLogs([])}
        style={{ float: "right", marginRight: "10px" }}
      >
        CLEAR
      </button>
      <div style={{ marginTop: "20px" }}>
        {logs.map((log, i) => (
          <div
            key={i}
            style={{
              borderBottom: "1px solid #222",
              padding: "2px 0",
              color: log.startsWith("ERR") ? "#ff4444" : "#00ff00",
            }}
          >
            {log}
          </div>
        ))}
      </div>
    </div>
  );
};

export default DebugConsole;
