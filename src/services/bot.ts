import { CacheType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Logger } from 'log4js';
import { Podcast } from 'podparse';
import PodcastFeedRow from '../models/db/podcast-feed-row.js';
import DiscordMessageSender from './discord/discord-message-sender.js';
import HelpCommand from './interaction-command/commands/help-command.js';
import SearchCommand from './interaction-command/commands/search-command.js';
import OutgoingMessageFactory from './outgoing-message/outgoing-message-factory.js';
import PodcastAppleAPIProcessor from './podcast/podcast-apple-api-processor.js';
import PodcastDataStorage from './podcast/podcast-data-storage.js';
import PodcastHelpers from './podcast/podcast-helpers.js';

interface BotInterface {
    readonly discordMessageSender: DiscordMessageSender;
    readonly helpCommand: HelpCommand;
    readonly logger: Logger;
    readonly outgoingMessageFactory: OutgoingMessageFactory;
    readonly podcastAppleApiProcessor: PodcastAppleAPIProcessor;
    readonly podcastDataStorage: PodcastDataStorage;
    readonly podcastHelpers: PodcastHelpers;
    readonly searchCommand: SearchCommand;

    sendMostRecentPodcastEpisode(podcast: Podcast, channelId: string | undefined): Promise<void>;
    receiveInteraction(interaction: ChatInputCommandInteraction<CacheType>): void;
}

export default class Bot implements BotInterface {
    constructor(
        readonly discordMessageSender: DiscordMessageSender,
        readonly helpCommand: HelpCommand,
        readonly logger: Logger,
        readonly outgoingMessageFactory: OutgoingMessageFactory,
        readonly podcastAppleApiProcessor: PodcastAppleAPIProcessor,
        readonly podcastDataStorage: PodcastDataStorage,
        readonly podcastHelpers: PodcastHelpers,
        readonly searchCommand: SearchCommand,
    ) {}

    async receiveInteraction(interaction: ChatInputCommandInteraction<CacheType>) {
        try {
            switch (interaction.commandName) {
                case 'search':
                    await this.searchCommand.execute(interaction);
                    break;
                case 'follow':
                    await this.follow(interaction);
                    break;
                case 'follow-rss':
                    await this.followRss(interaction);
                    break;
                case 'unfollow':
                    await this.unfollow(interaction);
                    break;
                case 'following':
                    await this.following(interaction);
                    break;
                default:
                    this.helpCommand.execute(interaction);
                    break;
            }
        } catch (error) {
            const title = 'receiveInteraction method failed';
            this.logger.info(title, { command: interaction.commandName, interaction, error });
            await this.sendErrorToChannel(interaction);
        }
    }

    async sendMostRecentPodcastEpisode(podcast: Podcast, channelInput: string = ''): Promise<void> {
        try {
            const outgoingMessage = this.outgoingMessageFactory.buildPodcastEpisodeMessage(podcast);
            const feedUrl = podcast.meta.importFeedUrl || '';

            let channelList = [channelInput];
            if (!channelInput) {
                channelList = this.podcastDataStorage.getChannelsByFeedUrl(feedUrl);
            }

            const mostRecentEpisode = this.podcastHelpers.getMostRecentPodcastEpisode(podcast);
            for (const channelId of channelList) {
                await this.sendMessageToChannel(channelId, outgoingMessage);
                this.podcastDataStorage.updatePostedData(feedUrl, mostRecentEpisode);
            }
        } catch (error) {
            const title = 'sendMostRecentPodcastEpisode method failed';
            this.logger.info(title, { podcast, error });
        }
    }

    private async follow(interaction: ChatInputCommandInteraction<CacheType>) {
        const searchKeywords = interaction.options.getString('keywords') || '';
        const podcastList = await this.podcastAppleApiProcessor.search(searchKeywords, 1);

        await this.followPodcastList(interaction, podcastList);
    }

    private async followRss(interaction: ChatInputCommandInteraction<CacheType>) {
        const feedUrl = interaction.options.getString('feed') || '';
        const podcast = await this.podcastHelpers.getPodcastFromUrl(feedUrl);
        const podcastList = !podcast ? [] : [podcast];

        await this.followPodcastList(interaction, podcastList);
    }

    private async unfollow(interaction: ChatInputCommandInteraction<CacheType>) {
        const feedId = interaction.options.getString('id') || '';
        const feed = this.podcastDataStorage.getFeedByFeedId(feedId);
        if (!feed) {
            await this.sendNoMatchesMessageToChannel(interaction);
            return;
        }

        this.podcastDataStorage.removeFeed(feedId, interaction.channelId);
        const message = this.outgoingMessageFactory.buildUnfollowedMessage(
            feed.title,
            this.podcastDataStorage.getFeedsByChannelId(interaction.channelId),
        );
        await interaction.editReply({ embeds: [message] });
    }

    private async following(interaction: ChatInputCommandInteraction<CacheType>) {
        // Helper method to validate message is not null and send it
        const sendMessage = async (message: EmbedBuilder | null) => {
            if (message) {
                await this.sendMessageToChannel(interaction.channelId, message);
            }
        };

        const feedList = this.podcastDataStorage.getFeedsByChannelId(interaction.channelId);
        interaction.deleteReply();

        const partialFeedList: PodcastFeedRow[] = [];
        let message = null;
        for (let index = 0; index < feedList.length; index++) {
            partialFeedList.push(feedList[index]);
            try {
                // Try to build the message and store it outside the loop for sending
                message = this.outgoingMessageFactory.buildFollowingMessage(partialFeedList);
            } catch (error) {
                const isSetDescriptionError =
                    error instanceof Error && error.stack?.includes('EmbedBuilder.setDescription');
                if (isSetDescriptionError) {
                    // Because building the message failed reset the list, undo increment, and send it
                    partialFeedList.length = 0;
                    index--;
                    await sendMessage(message);
                } else {
                    throw error;
                }
            }
        }
        // Send any lingering messages
        await sendMessage(message);
    }

    private async followPodcastList(
        interaction: ChatInputCommandInteraction<CacheType>,
        podcastList: Podcast[],
    ) {
        // TODO: This only supports following a list of quantity 1.
        if (podcastList.length !== 1) {
            await this.sendNoMatchesMessageToChannel(interaction);
            return;
        }
        this.podcastDataStorage.addFeed(podcastList[0], interaction.channelId);
        const message = this.outgoingMessageFactory.buildFollowedMessage(
            podcastList[0],
            this.podcastDataStorage.getFeedsByChannelId(interaction.channelId),
        );
        await interaction.editReply({ embeds: [message] });

        // Post most recent episode after follow has completed
        for (const podcast of podcastList) {
            // If the most recent episode is old only post to the channel the follow request came from
            const recentEpisodeIsOld = !this.podcastHelpers.mostRecentPodcastEpisodeIsNew(podcast);
            const channelInput = recentEpisodeIsOld ? interaction.channelId : '';
            await this.sendMostRecentPodcastEpisode(podcast, channelInput);
        }
    }

    private async sendMessageToChannel(
        channelId: string,
        embedBuilder: EmbedBuilder,
    ): Promise<void> {
        try {
            await this.discordMessageSender.send(channelId, embedBuilder);

            const memory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + 'MB';
            this.logger.info('Message Send Success', {
                title: embedBuilder.data.title,
                channelId,
                memory,
            });
        } catch (error) {
            this.logger.error('Message Send Failure', {
                message: embedBuilder.toJSON(),
                channelId,
                error,
            });
        }
        return;
    }

    private sendNoMatchesMessageToChannel(interaction: ChatInputCommandInteraction<CacheType>) {
        return interaction.editReply('Nothing was found matching your query.');
    }

    private sendErrorToChannel(interaction: ChatInputCommandInteraction<CacheType>) {
        const message =
            "Something went wrong. Check the bot's permissions, your input, and the podcast data.";
        return interaction.editReply(message);
    }
}
