import * as React from 'react'
import { TabBar } from '../tab-bar'
import { Remote } from './remote'
import { GitIgnore } from './git-ignore'
import { assertNever } from '../../lib/fatal-error'
import { IRemote } from '../../models/remote'
import { Dispatcher } from '../dispatcher'
import { PopupType } from '../../models/popup'
import { Repository } from '../../models/repository'
import { Dialog, DialogError, DialogFooter } from '../dialog'
import { NoRemote } from './no-remote'
import { readGitIgnoreAtRoot } from '../../lib/git'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { GitConfigLocation, GitConfig } from './git-config'
import {
  getConfigValue,
  getGlobalConfigValue,
  setConfigValue,
} from '../../lib/git/config'
import {
  gitAuthorNameIsValid,
  invalidGitAuthorNameMessage,
} from '../lib/identifier-rules'

interface IRepositorySettingsProps {
  readonly dispatcher: Dispatcher
  readonly remote: IRemote | null
  readonly repository: Repository
  readonly onDismissed: () => void
}

enum RepositorySettingsTab {
  Remote = 0,
  IgnoredFiles,
  GitConfig,
}

interface IRepositorySettingsState {
  readonly selectedTab: RepositorySettingsTab
  readonly remote: IRemote | null
  readonly ignoreText: string | null
  readonly ignoreTextHasChanged: boolean
  readonly disabled: boolean
  readonly saveDisabled: boolean
  readonly gitConfigLocation: GitConfigLocation
  readonly committerName: string
  readonly committerEmail: string
  readonly globalCommitterName: string
  readonly globalCommitterEmail: string
  readonly initialCommitterName: string | null
  readonly initialCommitterEmail: string | null
  readonly errors?: ReadonlyArray<JSX.Element | string>
}

export class RepositorySettings extends React.Component<
  IRepositorySettingsProps,
  IRepositorySettingsState
> {
  public constructor(props: IRepositorySettingsProps) {
    super(props)

    this.state = {
      selectedTab: RepositorySettingsTab.Remote,
      remote: props.remote,
      ignoreText: null,
      ignoreTextHasChanged: false,
      disabled: false,
      saveDisabled: false,
      gitConfigLocation: GitConfigLocation.Global,
      committerName: '',
      committerEmail: '',
      globalCommitterName: '',
      globalCommitterEmail: '',
      initialCommitterName: null,
      initialCommitterEmail: null,
    }
  }

  public async componentWillMount() {
    try {
      const ignoreText = await readGitIgnoreAtRoot(this.props.repository)
      this.setState({ ignoreText })
    } catch (e) {
      log.error(
        `RepositorySettings: unable to read root .gitignore file for ${
          this.props.repository.path
        }`,
        e
      )
      this.setState({ errors: [`Could not read root .gitignore: ${e}`] })
    }

    const initialCommitterName = await getConfigValue(
      this.props.repository,
      'user.name'
    )
    const initialCommitterEmail = await getConfigValue(
      this.props.repository,
      'user.email'
    )

    const globalCommitterName = (await getGlobalConfigValue('user.name')) || ''
    const globalCommitterEmail =
      (await getGlobalConfigValue('user.email')) || ''

    const gitConfigLocation =
      initialCommitterName === globalCommitterName &&
      initialCommitterEmail === globalCommitterEmail
        ? GitConfigLocation.Global
        : GitConfigLocation.Local

    const committerName = initialCommitterName || ''
    const committerEmail = initialCommitterEmail || ''

    this.setState({
      gitConfigLocation,
      committerName,
      committerEmail,
      globalCommitterName,
      globalCommitterEmail,
      initialCommitterName,
      initialCommitterEmail,
    })
  }

  private renderErrors(): JSX.Element[] | null {
    const errors = this.state.errors

    if (!errors || !errors.length) {
      return null
    }

    return errors.map((err, ix) => {
      const key = `err-${ix}`
      return <DialogError key={key}>{err}</DialogError>
    })
  }

  public render() {
    return (
      <Dialog
        id="repository-settings"
        title={__DARWIN__ ? 'Repository Settings' : 'Repository settings'}
        onDismissed={this.props.onDismissed}
        onSubmit={this.onSubmit}
        disabled={this.state.disabled}
      >
        {this.renderErrors()}

        <TabBar
          onTabClicked={this.onTabClicked}
          selectedIndex={this.state.selectedTab}
        >
          <span>Remote</span>
          <span>{__DARWIN__ ? 'Ignored Files' : 'Ignored files'}</span>
          <span>{__DARWIN__ ? 'Git Config' : 'Git config'}</span>
        </TabBar>

        {this.renderActiveTab()}
        {this.renderFooter()}
      </Dialog>
    )
  }

  private renderFooter() {
    const tab = this.state.selectedTab
    const remote = this.state.remote
    if (tab === RepositorySettingsTab.Remote && !remote) {
      return null
    }

    return (
      <DialogFooter>
        <OkCancelButtonGroup
          okButtonText="Save"
          okButtonDisabled={this.state.saveDisabled}
        />
      </DialogFooter>
    )
  }

  private renderActiveTab() {
    const tab = this.state.selectedTab
    switch (tab) {
      case RepositorySettingsTab.Remote: {
        const remote = this.state.remote
        if (remote) {
          return (
            <Remote
              remote={remote}
              onRemoteUrlChanged={this.onRemoteUrlChanged}
            />
          )
        } else {
          return <NoRemote onPublish={this.onPublish} />
        }
      }
      case RepositorySettingsTab.IgnoredFiles: {
        return (
          <GitIgnore
            text={this.state.ignoreText}
            onIgnoreTextChanged={this.onIgnoreTextChanged}
            onShowExamples={this.onShowGitIgnoreExamples}
          />
        )
      }
      case RepositorySettingsTab.GitConfig: {
        return (
          <GitConfig
            gitConfigLocation={this.state.gitConfigLocation}
            onGitConfigLocationChanged={this.onGitConfigLocationChanged}
            name={this.state.committerName}
            email={this.state.committerEmail}
            globalName={this.state.globalCommitterName}
            globalEmail={this.state.globalCommitterEmail}
            onNameChanged={this.onCommitterNameChanged}
            onEmailChanged={this.onCommitterEmailChanged}
          />
        )
      }
    }

    return assertNever(tab, `Unknown tab type: ${tab}`)
  }

  private onPublish = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.PublishRepository,
      repository: this.props.repository,
    })
  }

  private onShowGitIgnoreExamples = () => {
    this.props.dispatcher.openInBrowser('https://git-scm.com/docs/gitignore')
  }

  private onSubmit = async () => {
    this.setState({ disabled: true, errors: undefined })
    const errors = new Array<JSX.Element | string>()

    if (this.state.remote && this.props.remote) {
      if (this.state.remote.url !== this.props.remote.url) {
        try {
          await this.props.dispatcher.setRemoteURL(
            this.props.repository,
            this.props.remote.name,
            this.state.remote.url
          )
        } catch (e) {
          log.error(
            `RepositorySettings: unable to set remote URL at ${
              this.props.repository.path
            }`,
            e
          )
          errors.push(`Failed setting the remote URL: ${e}`)
        }
      }
    }

    if (this.state.ignoreTextHasChanged && this.state.ignoreText !== null) {
      try {
        await this.props.dispatcher.saveGitIgnore(
          this.props.repository,
          this.state.ignoreText
        )
      } catch (e) {
        log.error(
          `RepositorySettings: unable to save gitignore at ${
            this.props.repository.path
          }`,
          e
        )
        errors.push(`Failed saving the .gitignore file: ${e}`)
      }
    }

    if (this.state.committerName !== this.state.initialCommitterName) {
      await setConfigValue(
        this.props.repository,
        'user.name',
        this.state.gitConfigLocation === GitConfigLocation.Global
          ? this.state.globalCommitterName
          : this.state.committerName
      )
    }

    if (this.state.committerEmail !== this.state.initialCommitterEmail) {
      await setConfigValue(
        this.props.repository,
        'user.email',
        this.state.gitConfigLocation === GitConfigLocation.Global
          ? this.state.globalCommitterEmail
          : this.state.committerEmail
      )
    }

    if (!errors.length) {
      this.props.onDismissed()
    } else {
      this.setState({ disabled: false, errors })
    }
  }

  private onRemoteUrlChanged = (url: string) => {
    const remote = this.props.remote

    if (!remote) {
      return
    }

    const newRemote = { ...remote, url }
    this.setState({ remote: newRemote })
  }

  private onIgnoreTextChanged = (text: string) => {
    this.setState({ ignoreText: text, ignoreTextHasChanged: true })
  }

  private onTabClicked = (index: number) => {
    this.setState({ selectedTab: index })
  }

  private onGitConfigLocationChanged = (value: GitConfigLocation) => {
    this.setState({ gitConfigLocation: value })
  }

  private onCommitterNameChanged = (committerName: string) => {
    const errors = new Array<JSX.Element | string>()

    if (gitAuthorNameIsValid(committerName)) {
      this.setState({ saveDisabled: false })
    } else {
      this.setState({ saveDisabled: true })
      errors.push(invalidGitAuthorNameMessage)
    }

    this.setState({ committerName, errors })
  }

  private onCommitterEmailChanged = (committerEmail: string) => {
    this.setState({ committerEmail })
  }
}
