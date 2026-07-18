from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import ipaddress
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a 13-day localhost certificate for WebTransport development")
    parser.add_argument("--output", default="room_origin/data")
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    key = ec.generate_private_key(ec.SECP256R1())
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Cenacle local room origin")])
    now = dt.datetime.now(dt.timezone.utc)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=13))
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                x509.IPAddress(ipaddress.ip_address("::1")),
            ]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    cert_der = certificate.public_bytes(serialization.Encoding.DER)
    (output / "certificate.pem").write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    (output / "certificate.key").write_bytes(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ))
    digest = base64.b64encode(hashlib.sha256(cert_der).digest()).decode()
    print(f"VITE_WT_CERT_HASH={digest}")
    print(f"Certificate expires {certificate.not_valid_after_utc.isoformat()}")


if __name__ == "__main__":
    main()
