package jimlind.announcecast.discord.message;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import jimlind.announcecast.Helper;
import jimlind.announcecast.podcast.Episode;
import jimlind.announcecast.podcast.Podcast;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.entities.MessageEmbed;

public class EpisodeMessage {
  public static MessageEmbed build(Podcast podcast, int index) {
    Episode episode = podcast.getEpisodeList().get(index);

    EmbedBuilder embedBuilder = new EmbedBuilder();
    embedBuilder.setDescription(getDescriptionText(episode));
    embedBuilder.setTitle(episode.getTitle(), episode.getLink());
    embedBuilder.setImage(episode.getImageUrl());
    embedBuilder.setAuthor(podcast.getTitle(), podcast.getShowUrl(), podcast.getImageUrl());
    embedBuilder.setFooter(getFooterText(episode));

    return embedBuilder.build();
  }

  private static String getDescriptionText(Episode episode) {
    String markdownText = Helper.htmlToMarkdown(episode.getDescription(), 1024);

    int newlineIndex = markdownText.indexOf('\n');
    if (newlineIndex == -1) {
      return markdownText;
    }

    return markdownText.substring(0, newlineIndex);
  }

  private static String getDuration(Episode episode) {
    if (episode.getDuration().isBlank()) {
      return "";
    }

    int hours;
    int minutes;
    int seconds;

    String[] timeSlices = episode.getDuration().split(":");
    if (timeSlices.length == 3) {
      hours = Integer.parseInt(timeSlices[0]);
      minutes = Integer.parseInt(timeSlices[1]);
      seconds = Integer.parseInt(timeSlices[2]);
    } else {
      int totalSeconds = Integer.parseInt(episode.getDuration());
      hours = totalSeconds / 3600;
      minutes = (totalSeconds % 3600) / 60;
      seconds = totalSeconds % 60;
    }

    if (hours > 0) {
      return String.format("%sh %sm %ss", hours, minutes, seconds);
    } else if (minutes > 0) {
      return String.format("%sm %ss", minutes, seconds);
    } else {
      return String.format("%ss", seconds);
    }
  }

  private static String getFooterText(Episode episode) {
    List<String> footerPieces = new ArrayList<>();

    String episodeText = "";
    episodeText += isValid(episode.getSeasonId()) ? "S" + episode.getSeasonId() : "";
    episodeText += isValid(episode.getSeasonId()) && isValid(episode.getEpisodeId()) ? ":" : "";
    episodeText += isValid(episode.getEpisodeId()) ? "E" + episode.getEpisodeId() : "";
    footerPieces.add(episodeText);
    footerPieces.add(getDuration(episode));
    footerPieces.add(
        episode.getExplicit().equals("true") ? "Parental Advisory - Explicit Content" : "");

    return footerPieces.stream()
        .filter(input -> !input.isEmpty())
        .collect(Collectors.joining(" | "));
  }

  private static boolean isValid(String input) {
    if (input == null) {
      return false;
    }
    return !input.isBlank();
  }
}
