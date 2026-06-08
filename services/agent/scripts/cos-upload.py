"""Upload a file to Tencent COS using cos-python-sdk-v5 (reliable multipart)."""
import os, sys, io
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
)
client = CosS3Client(config)

print("[cos-upload] " + local_path + " -> cos://" + bucket + "/" + cos_key)
response = client.upload_file(
    Bucket=bucket,
    LocalFilePath=local_path,
    Key=cos_key,
    MAXThread=5,
    EnableMD5=False,
    PartSize=50,
)
print(f"[cos-upload] done ETag={response.get('ETag', '?')}")
