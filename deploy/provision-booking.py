"""Root-only server provisioning. Never prints credentials."""
from pathlib import Path
import secrets
import sys
from dotenv import dotenv_values

DIRECTORY = Path("/etc/uwelnes")


def configure():
    directory = DIRECTORY
    directory.mkdir(mode=0o700, exist_ok=True)
    postgres = directory / "postgres.env"
    if not postgres.exists():
        postgres.write_text(f"POSTGRES_USER=postgres\nPOSTGRES_DB=uwelnes\nPOSTGRES_PASSWORD={secrets.token_hex(32)}\n")
    postgres.chmod(0o600)
    bot = directory / "bot.env"
    values = dotenv_values(bot)
    updates = {}
    if not values.get("DATABASE_URL"):
        password = secrets.token_hex(32)
        updates["DATABASE_URL"] = f"postgresql+psycopg://uwelnes_app:{password}@127.0.0.1:55432/uwelnes"
    if not values.get("CORS_ORIGINS"):
        updates["CORS_ORIGINS"] = '["https://uwelnes.site"]'
    with bot.open("a") as output:
        for key, value in updates.items():
            output.write(f"\n{key}={value}\n")
    bot.chmod(0o600)
    print("Protected database configuration ready; credentials hidden.")


def role():
    import psycopg
    from psycopg import sql
    from sqlalchemy.engine import make_url
    values = dotenv_values(DIRECTORY / "postgres.env")
    url = make_url(dotenv_values(DIRECTORY / "bot.env")["DATABASE_URL"])
    with psycopg.connect(host="127.0.0.1", port=55432, dbname="uwelnes",
                         user=values["POSTGRES_USER"], password=values["POSTGRES_PASSWORD"], autocommit=True) as connection:
        exists = connection.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (url.username,)).fetchone()
        if not exists:
            connection.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(url.username), sql.Literal(url.password)))
        connection.execute(sql.SQL("GRANT CONNECT ON DATABASE uwelnes TO {}").format(sql.Identifier(url.username)))
        connection.execute(sql.SQL("GRANT USAGE, CREATE ON SCHEMA public TO {}").format(sql.Identifier(url.username)))
    print("Dedicated application role provisioned without superuser privileges.")


if __name__ == "__main__":
    {"configure": configure, "role": role}[sys.argv[1]]()
