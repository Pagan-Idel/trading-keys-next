import { OrderParameters } from "../../../components/Keyboard";
import { pipIncrement, recentTrade } from "../../shared";
import { OpenTrade, Trade, TradeById, openNow } from "./openNow";
import { ACTION } from "./order";

interface ModifyRequest {
  takeProfit?: OrderDetails;
  stopLoss?: OrderDetails;
}

interface OrderDetails {
  timeInForce: string;
  price: string;
}
export const modifyTrade = async (orderType: OrderParameters): Promise<boolean> => {
  const token = localStorage.getItem('token');
  const accountType = localStorage.getItem('accountType');
  const hostname = accountType === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
  const accountId = accountType === 'live' ? '[redacted]' : '[redacted]';
  // Check if the environment variable is set
  if (!accountId || !token) {
    console.log("Token or AccountId is not set.");
  }
  const mostRecentTrade: Trade | undefined = await recentTrade();
  if (!mostRecentTrade) {
    return false;
  }
  if (orderType.action == ACTION.SLatEntry) {
    const requestBody: ModifyRequest = {
      stopLoss: {
        price: mostRecentTrade.price!,
        timeInForce: "GTC"
      }
    };
    const apiUrl = `${hostname}/v3/accounts/${accountId}/trades/${mostRecentTrade.id}/orders`;

    const response = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept-Datetime-Format': 'RFC3339'
      },
      body: JSON.stringify({
        ...requestBody, // Merge additional body parameters if needed
      }),
    });

    if (!response.ok) {
      console.log(`HTTP error! Status: ${response.status}`);
    }
    return true;
  } else if (orderType.action == ACTION.MoveSL || orderType.action == ACTION.MoveTP) {
    const apiUrl1: string = `${hostname}/v3/accounts/${accountId}/trades/${mostRecentTrade.id}`;

    const response1: Response = await fetch(apiUrl1, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
    });

    if (!response1.ok) {
      console.log(`HTTP error! Status: ${response1.status}`);
    }
    const response1Object: TradeById = await response1.json();
    console.log("response1Object", response1Object);
    console.log("price",response1Object.trade.stopLossOrder!.price);
    if (!response1Object.trade.stopLossOrder) {
      console.log(`No Stop Loss Detected`);
      return false;
    }
    let requestBody: ModifyRequest = {};
    if (orderType.action == ACTION.MoveSL) {
      requestBody = {
        stopLoss: {
          price: orderType.action2 == ACTION.DOWN ? (parseFloat(response1Object.trade.stopLossOrder!.price) - pipIncrement).toFixed(5) : (parseFloat(response1Object.trade.stopLossOrder!.price) + pipIncrement).toFixed(5),
          timeInForce: "GTC"
        }
      };
   } else {
    requestBody = {
      takeProfit: {
        price: orderType.action2 == ACTION.DOWN ? (parseFloat(response1Object.trade.takeProfitOrder!.price) - pipIncrement).toFixed(5) : (parseFloat(response1Object.trade.takeProfitOrder!.price) + pipIncrement).toFixed(5),
        timeInForce: "GTC"
      }
    };
   }
    const apiUrl2 = `${hostname}/v3/accounts/${accountId}/trades/${mostRecentTrade.id}/orders`;

    const response = await fetch(apiUrl2, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept-Datetime-Format': 'RFC3339'
      },
      body: JSON.stringify({
        ...requestBody, // Merge additional body parameters if needed
      }),
    });

    if (!response.ok) {
      console.log(`HTTP error! Status: ${response.status}`);
    }
    return true;

  } else if (orderType.action == ACTION.PartialClose) {

  }
  return false;
};