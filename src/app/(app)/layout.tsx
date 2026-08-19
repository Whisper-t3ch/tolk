import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import AIAssistant from "@/components/layout/AIAssistant";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Sidebar />
      <div
        style={{
          marginLeft: "80px",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "margin-left 0.3s ease",
        }}
      >
        <Header />
        <main
          style={{
            flex: 1,
            padding: "24px",
            background: "#F5F3EF",
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {children}
        </main>
      </div>
      <AIAssistant />
    </>
  );
}
