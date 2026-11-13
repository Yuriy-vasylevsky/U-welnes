import { PoolMap } from "../components/pool-map";
import Link from "next/link";
export default function Pool() {
  return (
    <div className="pool-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">U-WELLNESS / БАСЕЙН</p>
          <h1>Ваш простір біля води</h1>
        </div>
        <p className="intro">
          Ознайомтеся з територією
          <br />
          та знайдіть свій куточок спокою.
        </p>
      </div>
      <div className="pool-book-link">
        <Link className="gold-button" href="/book">
          Забронювати шезлонг
        </Link>
      </div>
      <PoolMap />
    </div>
  );
}
