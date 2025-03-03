// TO DO: move all this to UserProvider
import React from 'react';
import { Modal, message } from 'antd';
// eslint-disable-next-line camelcase
import jwt_decode from 'jwt-decode';
import { history } from './helpers';
import { feathersClient } from './feathersClient';
import config from '../configuration';

export const historyBackWFallback = fallbackUrl => {
  const destUrl = fallbackUrl || '/';
  const prevPage = window.location.href;

  window.history.go(-1);

  setTimeout(() => {
    if (window.location.href === prevPage) {
      window.location.href = destUrl;
    }
  }, 500);
};

const authenticate = async (address, redirectOnFail, web3) => {
  const authData = {
    strategy: 'web3',
    address,
  };
  const accessToken = await feathersClient.authentication.getAccessToken();
  if (accessToken) {
    const payload = jwt_decode(accessToken);
    if (address === payload.userId) {
      await feathersClient.reAuthenticate(); // authenticate the socket connection
      return true;
    }
    await feathersClient.logout();
  }

  try {
    await feathersClient.authenticate(authData);
    window.analytics.identify(address);
    return true;
  } catch (response) {
    // normal flow will issue a 401 with a challenge message we need to sign and send to
    // verify our identity
    if (response.code === 401 && response.message.startsWith('Challenge =')) {
      const msg = response.message.replace('Challenge =', '').trim();

      const res = await new Promise(resolve =>
        Modal.confirm({
          title: 'You need to sign in!',
          centered: true,
          content:
            // 'By signing in we are able to provide instant updates to the app after you take an action. The signin process simply requires you to verify that you own this address by signing a randomly generated message. If you choose to skip this step, the app will not reflect any actions you make until the transactions have been mined.',
            'In order to provide the best experience possible, we are going to ask you to sign a randomly generated message proving that you own the current account. This will enable us to provide instant updates to the app after any action.',
          cancelText: 'Not now',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        }),
      );

      if (!res) {
        if (redirectOnFail) historyBackWFallback();
        return false;
      }

      message.info('Please sign the MetaMask transaction...');

      // we have to wrap in a timeout b/c if you close the chrome window MetaMask opens, the promise never resolves
      const signOrTimeout = () =>
        // TODO: take care of this warning
        // eslint-disable-next-line no-async-promise-executor
        new Promise(async resolve => {
          const timeOut = setTimeout(() => {
            resolve(false);
            historyBackWFallback();
          }, 30000);

          try {
            const signature = await web3.eth.personal.sign(msg, address);
            authData.signature = signature;
            await feathersClient.authenticate(authData);
            window.analytics.identify(address);
            clearTimeout(timeOut);
            resolve(true);
          } catch (e) {
            clearTimeout(timeOut);
            historyBackWFallback();
            resolve(false);
          }
        });

      return signOrTimeout();
    }
  }
  return false;
};

let authPromise;
/*
 * Attempt to authenticate the feathers connection for the currentUser
 * if not already authenticated
 *
 * @param {User} currentUser Current User object
 *
 * @returns {boolean} true if authenticate, otherwise false
 */
export const authenticateUser = async (currentUser, redirectOnFail, web3) => {
  if (authPromise) return !!(await authPromise);
  if (!currentUser || !currentUser.address) return false;

  if (currentUser.authenticated) return true;

  // prevent asking user to sign multiple msgs if currently authenticating
  authPromise = authenticate(currentUser.address, redirectOnFail, web3);
  currentUser.authenticated = await authPromise;
  authPromise = undefined;

  return currentUser.authenticated;
};

/**
 * Check if the user has registered a profile. If not, ask the user to register one.
 */
export const checkProfile = async currentUser => {
  // already created a profile
  if (!currentUser || currentUser.name) return;

  let modal;
  await new Promise(resolve => {
    modal = Modal.confirm({
      title: 'Please Register!',
      content:
        'It appears that you have not yet created your profile. In order to gain the trust of givers, we strongly recommend creating your profile!',
      cancelText: 'Skip',
      centered: true,
      onOk: () => {
        resolve();
        history.push('/profile');
      },
      onCancel: () => {
        resolve();
      },
    });
  }).then(() => modal.destroy());
};

/**
 * Check if the user is connected to the foreign network
 */
export const checkForeignNetwork = async (isForeignNetwork, displayForeignNetRequiredWarning) => {
  // already on correct network
  if (isForeignNetwork) return Promise.resolve();

  displayForeignNetRequiredWarning(historyBackWFallback, 'Back');
  return Promise.reject(new Error('wrongNetwork'));
};

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Checks for sufficient wallet balance.
 *
 * @param balance {BN} balance object
 *
 */
export const checkBalance = balance =>
  new Promise(resolve => {
    if (balance && balance.gte(React.minimumWalletBalanceInWei)) {
      resolve();
    } else {
      Modal.warning({
        title: 'Insufficient wallet balance',
        content: (
          <p>
            Be patient, you need at least {React.minimumWalletBalance} {config.foreignNetworkName}{' '}
            {config.nativeTokenName} in your wallet before you can interact with the Giveth DApp. We
            are sending some to you now!
          </p>
        ),
        centered: true,
      });
    }
  });
