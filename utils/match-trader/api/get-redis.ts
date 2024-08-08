
export interface ErrorMTResponse {
    errorMessage: string;
  }
    
export const getRedisMT = async (redisKey: string): Promise<string | ErrorMTResponse> => {

    const apiEndpoint = '/api/match-trader/get-redis';

    try {
    const response = await fetch(apiEndpoint, {
        method: 'GET',
        headers: {
          'rediskey': `${redisKey}`,
        }
    });

    const rawResponseText = await response.text();
    if (!response.ok) {
        let errorResponse: ErrorMTResponse;
        try {
        errorResponse = JSON.parse(rawResponseText);
        } catch (e) {
        console.error('Error parsing error response as JSON:', e);
        throw new Error(`Error: ${rawResponseText}`);
        }
        console.error('Market Watch failed:', errorResponse.errorMessage);
        return errorResponse;
    }

    let data: string;
    try {
        data = JSON.parse(rawResponseText);
    } catch (e) {
        console.error('Error parsing success response as JSON:', e);
        throw new Error(`Error: ${rawResponseText}`);
    }

    console.log('Market Match Successful');
    
    return data;
    } catch (error) {
    console.error('An error fetching Redis:', error);
    return { errorMessage: 'An unknown error occurred fetching Redis' } as ErrorMTResponse;
    }
};
