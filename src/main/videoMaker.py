import cv2
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from moviepy import VideoFileClip, AudioFileClip, ImageClip, concatenate_videoclips
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
    
    def mergeVideosFromUrlList(self, videoUrls, outputPath):
        if not videoUrls:
            raise ValueError("No valid MP4 clips to merge.")
        clips = []
        for url in videoUrls:
            clips.append(VideoFileClip(url))
        
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
        for url in videoUrls:
            os.remove(url)

        final_clip.close()
        return output_path
    

    def addNumbersToImages(self):
        font = ImageFont.truetype("./Fonts/Archivo-Regular.ttf", 70)
        text_color = (255, 255, 255)  # RGB color tuple
        background_color = (0,0,0)
    
        i = 1
        for imageFile in self.images:
            image = Image.open(imageFile)
            image_width, image_height = image.size
            draw = ImageDraw.Draw(image)
            text = str(i) + "."
            i += 1
            # Calculate the X-coordinate to center the text horizontally
            x_centered = (image_width-10) / 2
            y_position = image_height/4
            # Draw a shadow.
            draw.text((x_centered+2, y_position+2), text, fill=background_color, font=font)
            # Draw the background rectangle
            # left, top, right, bottom = draw.textbbox((x_centered, y_position), text, font=font)
            # draw.rectangle((left-5, top-5, right+5, bottom+5), fill=background_color)

            # Draw the text on top of the background, centered horizontally
            draw.text((x_centered, y_position), text, fill=text_color, font=font)

            # Save or display the modified image
            image.save(os.path.join(self.image_folder, imageFile))


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
    clip = VideoFileClip('/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/TestImages/video_2.mp4')
    print(f"FPS: {clip.fps}")

if __name__ == "__main__":
    main()