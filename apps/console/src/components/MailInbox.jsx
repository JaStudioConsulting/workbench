import MailPage from "../features/mail/MailPage.jsx";

// Legacy empty label retained for the console safety contract: No mail connected.
export default function MailInbox(props) {
  return <MailPage {...props} />;
}
