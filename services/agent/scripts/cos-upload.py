"""Upload a file to Tencent COS using cos-python-sdk-v5.

Parameters: local_path bucket region cos_key
Env:        COS_SECRET_ID  COS_SECRET_KEY

Uses PartSize=5MB + MAXThread=1 (sequential) for reliability on
slow/unstable cross-region links; retries the whole upload up to 3 times.
"""
import os, sys, io, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

try:
    from qcloud_cos import CosConfig, CosS3Client
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "cos-python-sdk-v5", "-q"])
    from qcloud_cos import CosConfig, CosS3Client

local_path = sys.argv[1]
bucket     = sys.argv[2]
region     = sys.argv[3]
cos_key    = sys.argv[4]

config = CosConfig(
    Region=region,
    SecretId=os.environ["COS_SECRET_ID"],
    SecretKey=os.environ["COS_SECRET_KEY"],
    Timeout=600,
)
client = CosS3Client(config)

size_mb = os.path.getsize(local_path) // 1024 // 1024
print(f"[cos-upload] {local_path} ({size_mb}MB) -> cos://{bucket}/{cos_key}")

MAX_ATTEMPTS = 3
for attempt in range(1, MAX_ATTEMPTS + 1):
    try:
        response = client.upload_file(
            Bucket=bucket,
            LocalFilePath=local_path,
            Key=cos_key,
            MAXThread=1,
            EnableMD5=False,
            PartSize=5,
        )
        print(f"[cos-upload] done ETag={response.get('ETag', '?')}")
        break
    except Exception as e:
        if attempt == MAX_ATTEMPTS:
            raise
        wait = 30 * attempt
        print(f"[cos-upload] attempt {attempt}/{MAX_ATTEMPTS} failed: {e}")
        print(f"[cos-upload] retrying in {wait}s...")
        time.sleep(wait)
