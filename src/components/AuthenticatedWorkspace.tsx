import App from "../App";
import { useArgusAuth } from "../auth-context";
import { ReportLaneProvider } from "../reports/shared/ReportLaneContext";
import { FeedbackButton } from "./FeedbackButton";
import { SessionExpiryNotice } from "./SessionExpiryNotice";

export function AuthenticatedWorkspace() {
  const { role } = useArgusAuth();
  return (
    <ReportLaneProvider key={role} allowSelection={role === "owner"} manageSelection>
      <SessionExpiryNotice />
      <FeedbackButton />
      <App />
    </ReportLaneProvider>
  );
}
