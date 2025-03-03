import React, { Component, Fragment } from 'react';
import BigNumber from 'bignumber.js';
import { Input, Select, Slider, Form, InputNumber, Modal, Typography, notification } from 'antd';
import Web3, { utils } from 'web3';
import PropTypes from 'prop-types';

import Donation from 'models/Donation';
import Trace from 'models/Trace';
import Campaign from 'models/Campaign';
import ReactTooltip from 'react-tooltip';
import DonationBlockchainService from '../../../services/DonationBlockchainService';
import { convertEthHelper, roundBigNumber, txNotification } from '../../../lib/helpers';
import AmountSliderMarks from '../../AmountSliderMarks';

function getFilterType(types, donation) {
  return types.filter(
    t => !(t instanceof Trace) || !t.acceptsSingleToken || t.token.symbol === donation.token.symbol,
  );
}

function getTypes(types) {
  return types.map(t => {
    const isTrace = t instanceof Trace;
    const el = {};
    el.name = t.title;
    el.type = isTrace ? Trace.type : Campaign.type;
    el.id = t._id;
    el.element = (
      <span>
        {t.title} <em>{isTrace ? 'Trace' : 'Campaign'}</em>
      </span>
    );
    if (isTrace) {
      el.campaignProjectId = t.campaign.projectId;
    }
    return el;
  });
}

// FIXME: We need slider component that uses bignumbers, there are some precision issues here
class DelegateButtonModal extends Component {
  constructor(props) {
    super(props);

    const { donation } = this.props;
    const { amountRemaining, token } = donation;

    this.state = {
      isSaving: false,
      usdRate: 0,
      objectsToDelegateToCampaign: [],
      objectsToDelegateToTrace: [],
      amount: convertEthHelper(amountRemaining, token.decimals),
      delegationComment: '',
      maxAmount: roundBigNumber(amountRemaining, 18),
      curProjectId: null,
    };

    this.form = React.createRef();

    this.submit = this.submit.bind(this);
    this.selectedObject = this.selectedObject.bind(this);
  }

  componentDidMount() {
    this.updateRates();
  }

  updateRates() {
    const { donation, getConversionRates } = this.props;
    getConversionRates(new Date(), donation.token.symbol, 'USD')
      .then(res => this.setState({ usdRate: res.rates.USD }))
      .catch(() => this.setState({ usdRate: 0 }));
  }

  selectedObject(type, { target }) {
    const { types, donation } = this.props;
    const { amount } = this.state;
    const admin = types.find(t => t._id === target.value[0]);

    let maxAmount = donation.amountRemaining;

    if (admin && admin instanceof Trace && admin.isCapped) {
      const maxDelegationAmount = admin.maxAmount.minus(admin.currentBalance);

      if (maxDelegationAmount.lt(donation.amountRemaining)) {
        maxAmount = maxDelegationAmount;
      }
    }

    const { decimals } = donation.token;
    const max = roundBigNumber(maxAmount, decimals);
    const sliderMarks = AmountSliderMarks(max, decimals);

    this.setState({
      maxAmount: max,
      amount: convertEthHelper(BigNumber.min(amount, maxAmount), decimals),
      sliderMarks,
    });

    if (type === Trace.type) {
      this.setState({
        objectsToDelegateToTrace: target.value,
      });
      if (admin) {
        const campaign = types.find(t => admin.campaign.projectId === t.projectId);
        this.setState({
          objectsToDelegateToCampaign: campaign ? [campaign._id] : [],
        });
      }
    } else {
      this.setState({
        curProjectId: admin ? admin.projectId : null,
        objectsToDelegateToCampaign: target.value,
      });

      const { objectsToDelegateToTrace } = this.state;
      if (objectsToDelegateToTrace.length > 0) {
        const trace = types.find(
          t => t.type === Trace.type && t._id === objectsToDelegateToTrace[0],
        );
        if (!admin || !trace || trace.campaign.projectId !== admin.projectId) {
          this.setState({ objectsToDelegateToTrace: [] });
        }
      }
    }
  }

  submit() {
    const { donation } = this.props;
    this.setState({ isSaving: true });

    const { objectsToDelegateToCampaign, objectsToDelegateToTrace } = this.state;
    const objectsToDelegateTo = objectsToDelegateToTrace[0] || objectsToDelegateToCampaign[0];
    // find the type of where we delegate to
    const admin = this.props.types.find(t => t._id === objectsToDelegateTo);

    // TODO: find a more friendly way to do this.
    if (
      admin instanceof Trace &&
      admin.isCapped &&
      admin.maxAmount.lte(admin.currentBalance || 0)
    ) {
      notification.error({
        message: '',
        description: 'That Trace has reached its funding goal. Please pick another.',
      });
      return;
    }

    const onCreated = txLink => {
      this.props.closeDialog();
      this.setState({ isSaving: false });
      const msg =
        donation.delegateId > 0 ? (
          <p>
            The Giver has <strong>3 days</strong> to reject your delegation before the money gets
            locked
          </p>
        ) : (
          <p>The Giver has been notified.</p>
        );

      Modal.success({
        title: 'Delegated!',
        content: (
          <Fragment>
            <p>
              The donation has been delegated,{' '}
              <a href={`${txLink}`} target="_blank" rel="noopener noreferrer">
                view the transaction here.
              </a>
            </p>
            {msg}
          </Fragment>
        ),
        centered: true,
      });
    };

    const onSuccess = txUrl => txNotification('Your donation has been confirmed!', txUrl);

    const onError = () => {
      this.setState({ isSaving: false });
      this.props.closeDialog();
    };

    DonationBlockchainService.delegate(
      donation,
      utils.toWei(this.state.amount),
      this.state.delegationComment,
      admin,
      onCreated,
      onSuccess,
      onError,
      this.props.web3,
    );
  }

  render() {
    const { types, traceOnly, donation } = this.props;
    const { token } = donation;
    const { decimals } = token;

    const {
      isSaving,
      objectsToDelegateToTrace,
      objectsToDelegateToCampaign,
      maxAmount,
      curProjectId,
      amount,
      sliderMarks,
      usdRate,
    } = this.state;

    const pStyle = { whiteSpace: 'normal' };

    const campaignTypes = [];
    const traceTypes = [];

    const traceOnlyCampaignTypes = [];
    const filteredTypes = getFilterType(types, donation);
    const objectsToDelegateTypes = getTypes(filteredTypes);

    objectsToDelegateTypes.forEach(t => {
      if (t.type === Trace.type) {
        if ([null, t.campaignProjectId].includes(curProjectId)) {
          traceTypes.push(t);
        }
      } else {
        campaignTypes.push(t);
      }
    });

    const campaignValue = [];
    if (traceOnly && filteredTypes.length > 0) {
      traceOnlyCampaignTypes.push(...getTypes([filteredTypes[0].campaign]));
      campaignValue.push(traceOnlyCampaignTypes[0].id);
    } else {
      campaignValue.push(...objectsToDelegateToCampaign);
    }

    let isZeroAmount = false;
    if (Number(amount) === 0) {
      isZeroAmount = true;
    }
    const totalSelected = objectsToDelegateToTrace.length + objectsToDelegateToCampaign.length;
    const formIsValid = totalSelected !== 0 && !isZeroAmount;
    const usdValue = usdRate * amount;

    return (
      <div id="delegate-modal">
        {traceOnly && <p>Select a Trace to delegate this donation to:</p>}
        {!traceOnly && <p>Select a Campaign or Trace to delegate this donation to:</p>}

        <p style={pStyle}>
          You are delegating donation made on{' '}
          <strong>{new Date(donation.createdAt).toLocaleDateString()}</strong> by{' '}
          <strong>{donation.giver.name || donation.giverAddress}</strong> of a value{' '}
          <strong>
            {donation.amountRemaining.toFixed()} {token.symbol}
          </strong>{' '}
          that has been donated to <strong>{donation.donatedTo.name}</strong>
        </p>
        <Form onFinish={this.submit}>
          <div className="form-group">
            <span className="label">
              Delegate to:
              <i
                className="fa fa-question-circle-o btn btn-sm btn-explain"
                data-tip="React-tooltip"
                data-for="delegateHint"
              />
              <ReactTooltip id="delegateHint" place="right" type="dark" effect="solid">
                Choose a Campaign or a Trace to delegate your funds to.
              </ReactTooltip>
            </span>
            <div>
              <Select
                name="delegateTo"
                placeholder="Select a Campaign"
                showSearch
                optionFilterProp="children"
                disabled={!!traceOnly}
                value={campaignValue}
                onSelect={v => this.selectedObject(Campaign.type, { target: { value: [v] } })}
                style={{ width: '100%' }}
                className="mb-3"
              >
                {(traceOnly ? traceOnlyCampaignTypes : campaignTypes).map(item => (
                  <Select.Option value={item.id} key={item.id}>
                    {item.name}
                  </Select.Option>
                ))}
              </Select>
              <Select
                name="delegateToTrace"
                placeholder="Select a Trace"
                showSearch
                optionFilterProp="children"
                value={objectsToDelegateToTrace}
                onSelect={v => this.selectedObject(Trace.type, { target: { value: [v] } })}
                style={{ width: '100%' }}
                className="mb-3"
              >
                {traceTypes.map(item => (
                  <Select.Option value={item.id} key={item.id}>
                    {item.name}
                  </Select.Option>
                ))}
              </Select>
            </div>
          </div>
          {objectsToDelegateToTrace.length + objectsToDelegateToCampaign.length !== 0 && (
            <React.Fragment>
              <span className="label">Amount to delegate:</span>

              <div className="form-group" id="amount_slider">
                <Slider
                  min={0}
                  max={maxAmount.toNumber()}
                  onChange={newAmount => {
                    this.setState({ amount: newAmount.toString() });
                  }}
                  value={amount}
                  marks={sliderMarks}
                  step={decimals ? 1 / 10 ** decimals : 1}
                />
              </div>

              <div className="form-group">
                <InputNumber
                  min={0}
                  max={maxAmount.decimalPlaces(Number(decimals), BigNumber.ROUND_DOWN).toNumber()}
                  id="amount-input"
                  value={amount}
                  onChange={newAmount => this.setState({ amount: newAmount })}
                  autoFocus
                  style={{ minWidth: '200px' }}
                  className="rounded"
                  size="large"
                  precision={decimals}
                />
                <Typography.Text className="ant-form-text pl-2" type="secondary">
                  ≈ {Math.round(usdValue)} USD
                </Typography.Text>
              </div>

              <div className="form-group">
                <Input.TextArea
                  name="comment"
                  id="comment-input"
                  className="rounded"
                  placeholder="Comment"
                  onChange={e => this.setState({ delegationComment: e.target.value })}
                />
              </div>
            </React.Fragment>
          )}

          <button
            className="btn btn-success"
            formNoValidate
            type="submit"
            disabled={isSaving || !formIsValid}
          >
            {isSaving ? 'Delegating...' : 'Delegate here'}
          </button>
        </Form>
      </div>
    );
  }
}

DelegateButtonModal.propTypes = {
  types: PropTypes.arrayOf(PropTypes.shape({})).isRequired,
  traceOnly: PropTypes.bool,
  donation: PropTypes.instanceOf(Donation).isRequired,
  closeDialog: PropTypes.func.isRequired,
  web3: PropTypes.instanceOf(Web3).isRequired,
  getConversionRates: PropTypes.func.isRequired,
};

DelegateButtonModal.defaultProps = {
  traceOnly: false,
};

export default DelegateButtonModal;
