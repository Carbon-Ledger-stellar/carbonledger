import urllib.request
import base64

with open('architecture.mmd', 'r') as f:
    mermaid = f.read()

encoded = base64.b64encode(mermaid.encode('utf-8')).decode('utf-8')
url = f'https://mermaid.ink/img/{encoded}'
print(f'Fetching from {url}')
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    response = urllib.request.urlopen(req)
    png_data = response.read()
    with open('architecture.png', 'wb') as f:
        f.write(png_data)
    print('Saved to architecture.png')
except Exception as e:
    print(f'Error: {e}')