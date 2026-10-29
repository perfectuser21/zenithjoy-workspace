# This image runs the existing ComfyUI interface without local generation models.
FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/comfyui
# Pin source by both commit and archive digest. Packages are pinned separately.
RUN python -c "import hashlib,urllib.request; u='https://codeload.github.com/Comfy-Org/ComfyUI/tar.gz/4845e7a3ffc48a6961f15824239e9042cc7d4ad1'; b=urllib.request.urlopen(u, timeout=90).read(); assert hashlib.sha256(b).hexdigest()=='9a7a105c8fb0163d86c953877e0ea03cca20a38b4f540248232e253906ca3700'; open('/tmp/comfy.tar.gz','wb').write(b)" \
 && tar -xzf /tmp/comfy.tar.gz --strip-components=1 -C /opt/comfyui \
 && rm /tmp/comfy.tar.gz
COPY infrastructure/comfyui/requirements-cpu.lock /tmp/requirements-cpu.lock
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r /tmp/requirements-cpu.lock \
 && rm /tmp/requirements-cpu.lock
COPY infrastructure/comfyui/custom_nodes/zenithjoy /opt/comfyui/custom_nodes/zenithjoy
COPY infrastructure/comfyui/workflows/image2-select-wan.json /opt/comfyui/custom_nodes/zenithjoy/web/image2-select-wan.json
RUN useradd --system --uid 10001 --home /data --no-create-home canvas \
 && mkdir -p /data/input /data/output /data/temp /data/user \
 && chown -R 10001:10001 /data
ENV HOME=/data
USER 10001:10001
EXPOSE 8188
CMD ["python", "main.py", "--cpu", "--listen", "0.0.0.0", "--offline", "--disable-all-custom-nodes", "--whitelist-custom-nodes", "zenithjoy", "--input-directory", "/data/input", "--output-directory", "/data/output", "--temp-directory", "/data/temp", "--user-directory", "/data/user", "--disable-auto-launch"]
