export function captureAccountMutation(accountId, epoch) {
  return { accountId: accountId || null, epoch: Number(epoch) || 0 };
}

export function accountMutationIsCurrent(mutation, accountId, epoch) {
  return !!mutation
    && mutation.accountId === (accountId || null)
    && mutation.epoch === (Number(epoch) || 0);
}
