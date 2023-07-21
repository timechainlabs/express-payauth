const express = require('express')
const asyncHandler = require('express-async-handler')
const bodyParser = require('body-parser')
const cors = require('cors')
const { buildGetPaymentDestinationRouter } = require('./buildGetPaymentDestinationRouter')
const { buildIdentityRouter } = require('./buildIndentityRouter')
const { buildVerifyPubkeyRouter } = require('./buildVerifyPubkeyRouter')
const { buildPublicProfileRouter } = require('./buildPublicProfileRouter')
const { buildAssetInformationRouter } = require('./buildAssetInformationRouter')
const { buildP2pPaymentDestinationRouter } = require('./buildP2pPaymentDestinationRouter')
const { buildP2pPaymentDestinationTokenRouter } = require('./buildP2pPaymentDestinationTokensRouter')
const { errorHandler } = require('./error-handler')
const { PaymailClient } = require('@moneybutton/paymail-client')
const dns = require('dns')
const fetch = require('isomorphic-fetch')
const urljoin = require('url-join')
const { URL } = require('url')
const { CapabilityCodes } = require('./constants')
const { buildReceiveTransactionRouter } = require('./buildReceiveTransactionRouter')
const { PaymailError } = require('./errors/PaymailError')

const getBaseRoute = (config) => {
  return config.basePath || '/'
}

const joinUrls = (...parts) => {
  return urljoin(...parts)
}

const validateBaseUrl = (url) => {
  try {
    url = new URL(url)
    if (url.protocol !== 'https:' && /^locahost:?\d*$/.test(url.hostname)) {
      console.warn('Paymail should always use ssl on production')
    }
    return url
  } catch (err) {
    throw new Error(`Invalid base url: ${url}`, err)
  }
}

/**
 * @callback getIdentityKey
 * @param {String} localPart - Local part of a paymail.
 * @param {String} domain - Domain of a paymail.
 * @returns {String} A string representing an identity public key for given paymail.
 *
 * @callback getPaymentDestination
 * @param {String} localPart - Local part of a paymail.
 * @param {String} domain - Domain of a paymail.
 * @param {Object} body - Request's body already parsed and converted into a JS object.
 * @param {Object} helpers - A bunch of handful functions to generate outputs.
 *
 * @callback verifyPublicKeyOwner
 * @param {String} localPart - Local part of a paymail.
 * @param {String} domain - Domain of a paymail.
 * @param {String} publicKeyToCheck - Public key to check agains given paymail.
 */

/**
 * Builds the main paymail router.
 *
 * @param {String} baseUrl - domain where the app is going to be placed. i.e https://moneybutton.com
 * @param {Object} config - Object containing the configuration for paymail router.
 * @param {getIdentityKey} config.getIdentityKey - Callback to get an identity key from an specific paymail address.
 * @param {getPaymentDestination} config.getPaymentDestination - Callback to get a payment output to send money to the owner of an specific paymail address.
 * @param {verifyPublicKeyOwner} config.verifyPublicKeyOwner - Callback to check if a public key belongs to a user.
 * @param {boolean} config.requestSenderValidation - If true requester identity is required and validated always.
 * @param {function} config.errorHandler - Express middleware to handle errors in custom way.
 */

const buildPaymailRouter = (baseUrl, config) => {
  const baseRouter = express.Router()
  baseRouter.use(bodyParser.json({ ...config.bodyParserConfig, type: 'application/json' }))
  const apiRouter = express.Router()
  baseUrl = validateBaseUrl(baseUrl)

  if (config.useCors) {
    baseRouter.use(cors(config.corsConfig || {}))
  }

  const capabilities = config.capabilities || {}

  capabilities[CapabilityCodes.requestSenderValidation] = !!config.requestSenderValidation

  buildIdentityRouter(config, (router) => {
    apiRouter.use(router)
    capabilities.pki = joinUrls(baseUrl.href, getBaseRoute(config), '/id/{alias}@{domain.tld}')
  })

  buildGetPaymentDestinationRouter(config, (router) => {
    apiRouter.use(router)
    capabilities.paymentDestination = joinUrls(baseUrl.href, getBaseRoute(config), '/address/{alias}@{domain.tld}')
  })

  buildVerifyPubkeyRouter(config, (router) => {
    apiRouter.use(router)
    capabilities[CapabilityCodes.verifyPublicKeyOwner] = joinUrls(baseUrl.href, getBaseRoute(config), '/verifypubkey/{alias}@{domain.tld}/{pubkey}')
  })

  buildPublicProfileRouter(config, (router) => {
    console.warn('This feature is in alpha state. Paymail profile protocol is still being discussed.')
    apiRouter.use(router)
    capabilities[CapabilityCodes.publicProfile] = joinUrls(baseUrl.href, getBaseRoute(config), '/public-profile/{alias}@{domain.tld}')
  })

  buildReceiveTransactionRouter(config, (router) => {
    // console.warn('This feature is in alpha state. Paymail profile protocol is still being discussed.')
    apiRouter.use(router)
    capabilities[CapabilityCodes.receiveTransaction] = joinUrls(baseUrl.href, getBaseRoute(config), '/receive-transaction/{alias}@{domain.tld}')
  })

  buildP2pPaymentDestinationRouter(config, (router) => {
    apiRouter.use(router)
    capabilities[CapabilityCodes.p2pPaymentDestination] = joinUrls(baseUrl.href, getBaseRoute(config), '/p2p-payment-destination/{alias}@{domain.tld}')
  })

  buildP2pPaymentDestinationTokenRouter(config, (router) => {
    apiRouter.use(router)
    capabilities[CapabilityCodes.p2pPaymentDestinationWithTokensSupport] = joinUrls(baseUrl.href, getBaseRoute(config), '/p2p-payment-destination-tokens-support/{alias}@{domain.tld}')
  })

  buildAssetInformationRouter(config, (router) => {
    apiRouter.use(router)
    capabilities[CapabilityCodes.assetInformation] = joinUrls(baseUrl.href, getBaseRoute(config), '/asset/{alias}@{domain.tld}')
  })

  capabilities['userDomain'] = joinUrls(baseUrl.href, getBaseRoute(config), '/oauth/{user}@{domain.tld}');
  capabilities['userDomainResponse'] = joinUrls(baseUrl.href, getBaseRoute(config), '/oauth/response/{app}@{domain.tld}');
  capabilities['userInfo']= joinUrls(baseUrl.href, getBaseRoute(config), '/payauth/userinfo/{user}@{domain.tld}');

  baseRouter.get('/.well-known/bsvalias', asyncHandler(async (req, res) => {
    res.type('application/json')
    res.send({
      bsvalias: '1.0',
      capabilities
    })
  }))

  baseRouter.use(getBaseRoute(config), apiRouter)

  baseRouter.use(config.errorHandler)

  return baseRouter
}

const buildRouter = (baseDomain, config) => {
  return buildPaymailRouter(baseDomain,
    {
      paymailClient: new PaymailClient(dns, fetch),
      useCors: true,
      corsConfig: {},
      errorHandler: errorHandler,
      bodyParserConfig: {},
      ...config
    }
  )
}

module.exports = { buildRouter, PaymailError }
