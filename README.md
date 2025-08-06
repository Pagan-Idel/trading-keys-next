Trading Keys App
Trading Keys is a personal trading application that interacts with both the Match-Trader API and Oanda API to execute trades and implement proper risk management strategies. Currently, the application supports trading the EUR/USD currency pair with automated processes for risk management and trade execution.

Note: This application is intended for my personal use only. Cloning, copying, or distributing this project is strictly prohibited.

Features
Match-Trader API Integration: Allows you to place and manage trades on the Match-Trader platform.
Oanda API Integration: Enables risk management and trading on the Oanda platform.
Risk Management: Automatic calculation of stop-loss and take-profit levels based on user-defined risk parameters.
EUR/USD Currency Pair: Currently, the app supports trading only for the EUR/USD pair.
Personal Use Only: This app is designed strictly for personal use and should not be cloned or shared.
Installation
To set up the Trading Keys app locally, follow these steps:

Clone the repository:

```bash
git clone https://github.com/your-username/trading-keys-next.git
```
Note: Cloning this repository is only allowed for personal use by the owner of this project.

Install dependencies:

Navigate to the project directory and install the required dependencies:

```bash
cd trading-keys-next

## Installation & Setup (All Platforms)

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/trading-keys-next.git
cd trading-keys-next
```

### 2. Install Dependencies
```bash
npm install
```


### 3. Set Up Credentials
Create a `credentials.json` file in the project root with your API credentials:
```json
{
  "MTR_DEMO_EMAIL": "your-demo-email",
  "MTR_DEMO_PASSWORD": "your-demo-password",
  "MTR_LIVE_EMAIL": "your-live-email",
  "MTR_LIVE_PASSWORD": "your-live-password",
  "OANDA_LIVE_ACCOUNT_ID": "your-live-account-id",
  "OANDA_LIVE_ACCOUNT_TOKEN": "your-live-account-token",
  "OANDA_DEMO_ACCOUNT_ID": "your-demo-account-id",
  "OANDA_DEMO_ACCOUNT_TOKEN": "your-demo-account-token"
}
```

### 5. Run the Application
```bash
npm run dev
```

---

## Running as a Background/Minimized Service (Windows)

1. **Use the Provided Batch and VBScript:**
   - `trading-keys.bat` starts the app.
   - `run_service_minimized.vbs` launches the batch file completely hidden (no window or taskbar icon).

2. **Create a Desktop Shortcut:**
   - Right-click `run_service_minimized.vbs` → Send to → Desktop (create shortcut).
   - Optionally, rename the shortcut (e.g., "Trading Keys Service").
   - Double-click the shortcut to start the app in the background.

---

## Running as a Background Service (macOS/Linux)

**macOS/Linux:**
You can use `nohup` or `screen` to run the app in the background:

```bash
nohup npm run dev &
# or
screen -dmS trading-keys npm run dev
```

---

## Stopping the Service

**Windows:**
 - Open Task Manager, find `node.exe` or `trading-keys.bat`, and end the process.

**macOS/Linux:**
 - Use `ps aux | grep node` to find the process and `kill <pid>` to stop it.

---


## Notes
- Make sure your credentials are correct in `credentials.json`.
- For production, consider using a process manager like PM2 (Node.js) or systemd (Linux) for reliability.
- Redis is **not required** for this project. All Redis-related code and setup have been removed.

---
Personal Use Disclaimer
This application is intended strictly for personal use only. Unauthorized copying, sharing, or distribution of this codebase is prohibited. By using this application, you agree to the following conditions:

The code within this repository may not be cloned, forked, or distributed without the express written permission of the owner.
Modifying and redistributing this application in any way is not allowed.
The application is provided "as is" with no warranty or liability.
License
This project is not open source and is subject to a custom restrictive license.

Future Features
Support for additional currency pairs.

Integration with more trading platforms.
Contact
For any inquiries or issues regarding this project, please contact the repository owner at idelpagan@gmail.com.

