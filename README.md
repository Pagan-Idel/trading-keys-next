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
npm install
```
Set up environment variables:

The app requires API credentials for both Match-Trader and Oanda. These should be provided in a credentials.json file located at the root of the project.

Example credentials.json:

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
Run the application:

You can run the app in development mode with the following command:

```bash
npm run dev
```
Start Redis (If Applicable):

If Redis is required for session or trade management, make sure to start Redis using the appropriate command for your environment.

On Ubuntu:

```bash
npm run redis-ubuntu
```

On Windows:

```bash
npm run redis-windows
```

Usage
Match-Trader Integration
The app provides full integration with Match-Trader for executing and managing trades. The app will automatically fetch your account data, including positions, orders, and balances, and allows you to interact with the platform seamlessly.

Oanda API
The Oanda integration allows for automated risk management, ensuring that trades are executed with predefined stop-loss and take-profit levels. This helps to minimize risk while maximizing potential returns.

Risk Management
Risk management features include:

Stop-Loss: Automatically set based on your risk tolerance.
Take-Profit: Configurable to lock in gains at a predetermined level.
Leverage Management: The app calculates risk according to your leverage settings.
Currently, only the EUR/USD currency pair is supported. Future updates may include support for additional pairs.

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

