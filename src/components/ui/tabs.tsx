"use client";
import React, { useState } from "react";
import { motion } from "framer-motion";

interface TabItem {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  items: TabItem[];
  defaultTab?: string;
}

export function Tabs({ items, defaultTab }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || items[0]?.id);

  return (
    <div style={{ width: "100%" }}>
      <div style={{
        display: "flex",
        gap: 8,
        borderBottom: "1px solid #E5DFD5",
        backgroundColor: "#FFFFFF",
        borderRadius: "8px 8px 0 0",
        padding: 8,
      }}>
        {items.map((tab) => (
          <motion.button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              paddingLeft: 16,
              paddingRight: 16,
              paddingTop: 8,
              paddingBottom: 8,
              fontWeight: 500,
              fontSize: 13,
              transition: "all 0.2s",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              backgroundColor: activeTab === tab.id ? "#2D6A5C" : "transparent",
              color: activeTab === tab.id ? "#FFFFFF" : "#6B6058",
            }}
            whileTap={{ scale: 0.95 }}
          >
            {tab.label}
          </motion.button>
        ))}
      </div>
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
        style={{
          backgroundColor: "#FFFFFF",
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 16,
          paddingBottom: 16,
          borderRadius: "0 0 8px 8px",
          borderLeft: "1px solid #E5DFD5",
          borderRight: "1px solid #E5DFD5",
          borderBottom: "1px solid #E5DFD5",
        }}
      >
        {items.find((tab) => tab.id === activeTab)?.content}
      </motion.div>
    </div>
  );
}
