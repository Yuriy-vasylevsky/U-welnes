import Link from "next/link";
import { PriceAdmin } from "../../../components/price-admin";
export default function PricesPage() {
  return (
    <>
      <Link className="admin-back" href="/admin">
        ← Меню адміністратора
      </Link>
      <PriceAdmin />
    </>
  );
}
