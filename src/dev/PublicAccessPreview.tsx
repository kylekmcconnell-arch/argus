import { useState } from "react";
import { PublicAccessHome } from "../components/PublicAccessHome";

export function PublicAccessPreview() {
  const [action, setAction] = useState("");

  return (
    <>
      <PublicAccessHome
        onLogin={() => setAction("Login selected")}
        onCode={(code) => setAction(`Access code: ${code}`)}
      />
      {action && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-line bg-panel px-4 py-2 text-[11px] text-ink shadow-xl">
          {action}
        </div>
      )}
    </>
  );
}
