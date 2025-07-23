import cv2
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from moviepy import VideoFileClip, vfx, AudioFileClip, ImageClip, CompositeVideoClip, TextClip, concatenate_videoclips
from moviepy.Effect import Effect
from helper import renameToJPEG, resizeImagesToFitWidth

class VideoMaker:
    def __init__(self):
        return

    def createVideoFromImageFolder(self, imageFolder, secondsPerImage):
        renameToJPEG(imageFolder)
        resizeImagesToFitWidth(imageFolder)
        images = [os.path.join(imageFolder, img) for img in os.listdir(imageFolder) if img.endswith(('jpeg'))]

        # Set the output video file name and its parameters
        video_name = os.path.join(imageFolder, 'video.mp4')
        clips = [ImageClip(img, duration=secondsPerImage) for img in images]
        video = concatenate_videoclips(clips, method="compose")
        video.write_videofile(video_name, fps=30, codec='libx264')
        return video_name
    
    def mergeVideosFromUrlList(self, videoUrls, outputPath, deleteIngredients=True):
        if not videoUrls:
            raise ValueError("No valid MP4 clips to merge.")
        clips = []
        for url in videoUrls:
            videoClip = VideoFileClip(url)
            # if url == videoUrls[0]:
            #     videoClip = VideoFileClip(url).with_effects([vfx.FadeOut(0.1)])
            # else:
            #     videoClip = VideoFileClip(url).with_effects([vfx.FadeIn(0.1), vfx.FadeOut(0.1)])
            clips.append(videoClip)
        
        final_clip = concatenate_videoclips(clips, method="chain")

        # Create export folder if it doesn't exist
        os.makedirs(outputPath, exist_ok=True)

        # Find an available filename
        base_name = "mergedVideoClips"
        ext = ".mp4"
        counter = 1
        while counter<=25:
            output_filename = f"{base_name}{counter}{ext}"
            output_path = os.path.join(outputPath, output_filename)
            if not os.path.exists(output_path):
                break
            counter += 1
    
        # Write the video file
        final_clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
        print(f"Merged video saved to: {output_path}")

        # Close and delete all clips to free memory
        for clip in clips:
            clip.close()

        if deleteIngredients:
            for url in videoUrls:
                os.remove(url)

        final_clip.close()
        return output_path
    
    def addTextToImage(self, imgUrl, text):
        font = ImageFont.truetype("./Fonts/Archivo-Regular.ttf", 70)
        text_color = (255, 255, 255)      # White text
        outline_color = (0, 0, 0)         # Black outline

        image = Image.open(imgUrl)
        image_width, image_height = image.size
        draw = ImageDraw.Draw(image)
        
        # Calculate the X-coordinate to center the text horizontally
        x_centered = (image_width / 2) - 25
        y_position = image_height / 10

        # Draw the text with a black stroke
        draw.text(
            (x_centered, y_position),
            text,
            font=font,
            fill=text_color,
            stroke_width=5,
            stroke_fill=outline_color
        )
        image.save(imgUrl)
    
    def addNumberToImage(self, imgUrl, number):
        font = ImageFont.truetype("./Fonts/Archivo-Regular.ttf", 70)
        text_color = (255, 255, 255)      # White text
        outline_color = (0, 0, 0)         # Black outline

        image = Image.open(imgUrl)
        image_width, image_height = image.size
        draw = ImageDraw.Draw(image)
        text = str(number) + "."

        # Calculate the X-coordinate to center the text horizontally
        x_centered = (image_width / 2) - 25
        y_position = (image_height / 2) - 100

        # Draw the text with a black stroke
        draw.text(
            (x_centered, y_position),
            text,
            font=font,
            fill=text_color,
            stroke_width=5,
            stroke_fill=outline_color
        )
        image.save(imgUrl)

    def addNumberToVideo(self, videoPath, number):
        temp_output = videoPath + "_temp.mp4" # Temporary output file path
        clip = VideoFileClip(videoPath) # Load the video
        text = f"{number}." # Define the text to overlay

        # Create the TextClip with black stroke
        txt_clip = TextClip(
            text=text,
            text_align="center",
            font_size=110,
            color='white',
            stroke_color='black',
            stroke_width=5,
            font='Archivo-Regular',      # Ensure the font is installed or replace it with 'Arial'
            method='label',               # Needed for fonts to apply correctly
            duration=clip.duration        
        ).with_position('center')

        final = CompositeVideoClip([clip, txt_clip]) # Combine video and text
        final.write_videofile(temp_output, codec="libx264", audio_codec="aac") # Write to temporary file
        os.remove(videoPath) # Replace original with new video
        os.rename(temp_output, videoPath)

    def addTextToVideo(self, videoPath, text):
        temp_output = videoPath + "_temp.mp4" # Temporary output file path
        clip = VideoFileClip(videoPath) # Load the video
        font_size = int(0.068*clip.h)
        margin = int(0.1*clip.w)

        # Create the TextClip with black stroke
        txt_clip = TextClip(
            text=text,
            text_align="center",
            font_size=125,
            size=(clip.w, clip.h),
            color='white',
            stroke_color='black',
            stroke_width=12,
            font='Archivo-Regular',      # Ensure the font is installed or replace it with 'Arial'
            method='label',               # Needed for fonts to apply correctly
            duration=clip.duration,
            margin=(margin,margin)
            # vertical_align="top",
            # horizontal_align="center",
        ).with_position(("center",clip.h/10))

        final = CompositeVideoClip([clip, txt_clip]) # Combine video and text
        final.write_videofile(temp_output, codec="libx264", audio_codec="aac") # Write to temporary file
        os.remove(videoPath) # Replace original with new video
        os.rename(temp_output, videoPath)


    def addMusic(self, videoPath, audioPath, start_time, outputPath=None):
        video_clip = VideoFileClip(videoPath)
        if outputPath is None:
            outputPath = os.path.dirname(videoPath)
        audio_clip = AudioFileClip(audioPath)
        # Trim the audio clip to start from a specific time
        audio_clip = AudioFileClip(audioPath).subclipped(start_time, start_time+video_clip.duration)
        # Set the audio of the video to the modified audio clip
        video_clip = video_clip.with_audio(audio_clip)
        # Write the final video to the output file
        video_clip.write_videofile(os.path.join(outputPath, "temp.mp4"), codec='libx264', audio_codec='aac', fps=30)
        # Replace old with new. There was a glitch if I ouput directly using the old video name.
        os.remove(videoPath)
        os.rename(os.path.join(outputPath, "temp.mp4"), videoPath)
        # Close the video and audio clips
        video_clip.close()
        audio_clip.close()

def main():
    # clip1 = "/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/TestImages/videoTransitions/video_1.mp4"
    # clip2 = "/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/TestImages/videoTransitions/video_2.mp4"
    # urls = {clip1, clip2}
    # outputPath = "/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/TestImages/videoTransitions"
    # videoMaker = VideoMaker()
    # videoMaker.mergeVideosFromUrlList(urls, outputPath, False)

    img = "/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/2025-07-14_13-01-57/_98644f31-b56b-4d18-9f84-03c8e26eba42.jpg"
    vid = "/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/TestImages/videoTransitions/video_1 copy.mp4"
    videoMaker = VideoMaker()
    videoMaker.addTextToVideo(vid, "Where can you live\n100 days if Mr. Beast\nmade you?")

if __name__ == "__main__":
    main()