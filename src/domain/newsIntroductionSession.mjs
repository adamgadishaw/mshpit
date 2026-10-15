// Runtime-only identities survive feed remounts, tab changes and account switches.
// Server receipts still prevent an already consumed story from being promoted
// after a restart. Keep no story text and fail closed rather than evicting a
// consumed identity when an unusually large number of accounts use one runtime.
export function createNewsIntroductionSession({maximumAccounts=32}={}) {
  const accounts=new Map();
  return {
    claim(accountId,createRequestId) {
      if (!accountId) return null;
      if (!accounts.has(accountId)) {
        if (accounts.size>=maximumAccounts) return null;
        accounts.set(accountId,{requestId:createRequestId(),complete:false,inFlight:null});
      }
      return accounts.get(accountId);
    },
  };
}
export const newsIntroductionSession=createNewsIntroductionSession();
