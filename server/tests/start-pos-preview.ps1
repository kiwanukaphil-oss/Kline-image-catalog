# Run the POS frontend against the already-running dedicated local test backend.
# This changes only environment variables in this PowerShell process.
$env:PORT = '3010'
$env:HOST = '127.0.0.1'
$env:BROWSER = 'none'
$env:REACT_APP_API_URL = 'http://127.0.0.1:5109/api'
$env:REACT_APP_ENABLE_BRANCH_SELECTOR = 'true'
Set-Location -LiteralPath 'C:\Projects\inventory-pos-system\frontend'
npm start
