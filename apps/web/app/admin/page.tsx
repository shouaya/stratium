import { AdminConsole } from "./admin-console";

export default function AdminPage() {
  return <AdminConsole apiBaseUrl={process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"} />;
}
