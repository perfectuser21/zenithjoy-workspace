FROM python:3.10-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy everything
COPY . .

# Create symlink for UI folder
RUN ln -sf /app/app/ui /app/ui

EXPOSE 8000

# Run from /app with module path
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
