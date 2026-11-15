import Link from "next/link";
import { SeatAdmin } from "../../../components/seat-admin";
export default function SeatsPage() {
  return (
    <>
      <Link className="admin-back" href="/admin">
        ← Меню адміністратора
      </Link>
      <SeatAdmin />
    </>
  );
}
