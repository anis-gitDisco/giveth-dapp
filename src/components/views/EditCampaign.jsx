import React, { Fragment, useContext, useEffect, useRef, useState } from 'react';
import { Prompt, useParams } from 'react-router-dom';

import { Button, Col, Form, Input, Modal, PageHeader, Row, Select, Typography } from 'antd';
import Loader from '../Loader';
import { getHtmlText, history, isOwner } from '../../lib/helpers';
import { authenticateUser, checkProfile } from '../../lib/middleware';
import CampaignService from '../../services/CampaignService';
import ErrorHandler from '../../lib/ErrorHandler';

import { Context as WhiteListContext } from '../../contextProviders/WhiteListProvider';
import { Context as UserContext } from '../../contextProviders/UserProvider';

import Web3ConnectWarning from '../Web3ConnectWarning';
import Editor from '../Editor';

import Campaign from '../../models/Campaign';
import { Context as Web3Context } from '../../contextProviders/Web3Provider';
import useReviewers from '../../hooks/useReviewers';
import UploadPicture from '../UploadPicture';

const { Title, Text } = Typography;

/**
 * View to create or edit a Campaign
 */
const EditCampaign = () => {
  const {
    state: { currentUser, isLoading: userIsLoading },
  } = useContext(UserContext);

  const {
    state: { projectOwnersWhitelistEnabled, isLoading: whitelistIsLoading },
  } = useContext(WhiteListContext);

  const {
    state: { isForeignNetwork, web3 },
    actions: { displayForeignNetRequiredWarning },
  } = useContext(Web3Context);

  const reviewers = useReviewers();

  const [isLoading, setIsLoading] = useState(true);
  const [isBlocking, setIsBlocking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [campaign, setCampaign] = useState({});

  const campaignObject = useRef(
    new Campaign({
      owner: currentUser,
      ownerAddress: currentUser.address,
    }),
  );
  const mounted = useRef();

  const { id: campaignId } = useParams();
  const isNew = !campaignId;

  const goBack = () => {
    history.goBack();
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (userIsLoading || whitelistIsLoading || !currentUser.address) return () => {};

    if (isNew) {
      if (!currentUser.isProjectOwner && projectOwnersWhitelistEnabled) {
        const modal = Modal.error({
          title: 'Permission Denied',
          content: 'You are not allowed to create a campaign',
          closable: false,
          centered: true,
          onOk: () => history.replace('/'),
        });

        return () => {
          modal.destroy();
        };
      }

      checkProfile(currentUser).then(() => {
        setCampaign({
          owner: currentUser,
          ownerAddress: currentUser.address,
        });
        setIsLoading(false);
      });
    } else {
      CampaignService.get(campaignId)
        .then(camp => {
          if (isOwner(camp.ownerAddress, currentUser)) {
            const imageIpfsPath = camp.image.match(/\/ipfs\/.*/);
            setCampaign({
              title: camp.title,
              description: camp.description,
              communityUrl: camp.communityUrl,
              reviewerAddress: camp.reviewerAddress,
              picture: imageIpfsPath ? imageIpfsPath[0] : camp.image,
            });
            campaignObject.current = camp;
            setIsLoading(false);
          } else {
            ErrorHandler({}, 'You are not allowed to edit this Campaign.');
            goBack();
          }
        })
        .catch(err => {
          if (err.status === 404) {
            history.push('/notfound');
          } else {
            setIsLoading(false);
            ErrorHandler(
              err,
              'There has been a problem loading the Campaign. Please refresh the page and try again.',
            );
          }
        });
    }

    return () => {};
  }, [userIsLoading, currentUser, whitelistIsLoading]);

  // TODO: Check if user Changes (in Class components checked in didUpdate)

  const handleInputChange = event => {
    const { name, value } = event.target;
    setCampaign({ ...campaign, [name]: value });
    setIsBlocking(true);
  };

  const onDescriptionChange = description => {
    handleInputChange({ target: { name: 'description', value: description } });
  };

  function setPicture(address) {
    handleInputChange({ target: { name: 'picture', value: address } });
  }

  useEffect(() => {
    if (campaign.image) {
      const imageIpfsPath = campaign.image.match(/\/ipfs\/.*/);
      const picture = imageIpfsPath ? imageIpfsPath[0] : campaign.image;
      setPicture(picture);
    }
  }, [campaign]);

  const setReviewer = (_, option) => {
    handleInputChange({
      target: { name: 'reviewerAddress', value: option.value },
    });
  };

  const submit = async () => {
    const authenticated = await authenticateUser(currentUser, false, web3);

    if (authenticated) {
      if (!isForeignNetwork) {
        displayForeignNetRequiredWarning();
        return;
      }

      Object.assign(campaignObject.current, {
        ...campaign,
        image: campaign.picture,
      });

      const afterCreate = ({ response, err }) => {
        if (mounted.current) setIsSaving(false);
        if (!err) history.push(`/campaign/${response.slug}`);
      };

      setIsSaving(true);
      setIsBlocking(false);
      campaignObject.current.save(web3, afterCreate).finally(() => {
        setIsSaving(false);
      });
    }
  };

  return (
    <Fragment>
      <Web3ConnectWarning />
      <Prompt
        when={isBlocking}
        message={() =>
          `You have unsaved changes. Are you sure you want to navigate from this page?`
        }
      />
      {isLoading ? (
        <Loader className="fixed" />
      ) : (
        <Fragment>
          <Row>
            <Col span={24}>
              <PageHeader
                className="site-page-header"
                onBack={goBack}
                title={isNew ? 'Create New Campaign' : `Edit Campaign ${campaign.title}`}
                ghost={false}
              />
            </Col>
          </Row>
          <Row>
            <div className="card-form-container">
              <Form
                className="card-form"
                requiredMark
                onFinish={submit}
                initialValues={{
                  title: campaign.title,
                  description: campaign.description,
                  reviewerAddress: campaign.reviewerAddress,
                  communityUrl: campaign.communityUrl,
                }}
                scrollToFirstError={{
                  block: 'center',
                  behavior: 'smooth',
                }}
              >
                {isNew && (
                  <Fragment>
                    <Title level={3}>Start a new Campaign!</Title>
                    <Text>
                      A Campaign solves a specific cause by executing a project via its Traces.
                      Funds raised by a Campaign need to be delegated to its Traces in order to be
                      paid out.
                    </Text>
                  </Fragment>
                )}
                <Form.Item
                  name="title"
                  label="What are you working on?"
                  className="custom-form-item"
                  extra="Describe your Campaign in 1 sentence."
                  rules={[
                    {
                      required: true,
                      type: 'string',
                      min: 3,
                      message: 'Please provide at least 3 characters',
                    },
                  ]}
                >
                  <Input
                    name="title"
                    placeholder="e.g. Support continued Development"
                    onChange={handleInputChange}
                  />
                </Form.Item>
                <Form.Item
                  name="description"
                  label="Explain how you are going to do this successfully."
                  className="custom-form-item"
                  extra="Make it as extensive as necessary. Your goal is to build trust, so that people donate Ether to your Campaign."
                  rules={[
                    {
                      required: true,
                      type: 'string',
                      message: 'Description is required',
                    },
                    {
                      validator: async (_, val) => {
                        if (val && getHtmlText(val).length <= 10) {
                          throw new Error(
                            'Please provide at least 10 characters and do not edit the template keywords.',
                          );
                        }
                      },
                    },
                  ]}
                >
                  <Editor
                    name="description"
                    onChange={onDescriptionChange}
                    value={campaign.description}
                    placeholder="Describe how you're going to execute your Campaign successfully..."
                  />
                </Form.Item>

                <UploadPicture
                  setPicture={setPicture}
                  picture={campaign.picture || ''}
                  imgAlt={campaign.title || ''}
                  label="Add a picture"
                  required
                />

                <Form.Item
                  name="communityUrl"
                  label="Url to join your Community"
                  className="custom-form-item"
                  extra="Where can people join your Community? Giveth redirects people there."
                  rules={[
                    {
                      type: 'string',
                      min: 3,
                      message: 'Please provide at least 3 characters',
                    },
                  ]}
                >
                  <Input
                    value={campaign.communityUrl}
                    name="communityUrl"
                    placeholder="https://slack.giveth.com"
                    onChange={handleInputChange}
                  />
                </Form.Item>
                <Form.Item
                  name="reviewerAddress"
                  label="Select a reviewer"
                  rules={[{ required: true }]}
                  extra="This person or smart contract will be reviewing your Campaign to increase trust for Givers."
                  className="custom-form-item"
                >
                  <Select
                    showSearch
                    placeholder="Select a reviewer"
                    optionFilterProp="children"
                    name="reviewerAddress"
                    onSelect={setReviewer}
                    filterOption={(input, option) =>
                      option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
                    }
                    value={campaign.reviewerAddress}
                  >
                    {reviewers.map(({ name, address }) => (
                      <Select.Option key={address} value={address}>
                        {`${name} - ${address}`}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
                <Form.Item>
                  <Button block size="large" type="primary" htmlType="submit" loading={isSaving}>
                    {isNew ? 'Create' : 'Update'} Campaign
                  </Button>
                </Form.Item>
              </Form>
            </div>
          </Row>
        </Fragment>
      )}
    </Fragment>
  );
};

export default EditCampaign;
