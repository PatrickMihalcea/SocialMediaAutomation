import cv2
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from moviepy import VideoFileClip, AudioFileClip, ImageClip, concatenate_videoclips

class videoMaker:
    def __init__(self, folder, secondsPerImage, zoomFactor):
        self.image_folder = folder
        self.renamePNGtoJPG()
        self.images = [img for img in os.listdir(self.image_folder) if img.endswith(".jpg")]
        self.width, self.height = 1080, 1920
        # Set the output video file name and its parameters
        self.video_name = os.path.join(self.image_folder, 'video.mp4') 

        self.resizeImagesToFitWidth()
        self.createVideo(secondsPerImage)
        # self.createVideoWithZoom(secondsPerImage,zoomFactor)

        cv2.destroyAllWindows()

    def renamePNGtoJPG(self):
        for filename in os.listdir(self.image_folder):
        # Check if the file is a PNG file
            if filename.endswith('.png'):
                new_filename = filename[:-4] + '.jpg'
                image = Image.open(os.path.join(self.image_folder, filename))
                rgb_im = image.convert('RGB')
                rgb_im.save(os.path.join(self.image_folder, new_filename))
                os.remove(os.path.join(self.image_folder, filename))

    def rotateImages(self):
        for imageFile in self.images:
            image = Image.open(os.path.join(self.image_folder, imageFile))
            rotatedImage = image.rotate(-90, expand=True)
            rotatedImage.save(os.path.join(self.image_folder, imageFile))
            rotatedImage.close()


    def resizeImagesToFitWidth(self):
        for image in self.images:
            img = os.path.join(self.image_folder, image)
            # Open the original 1024x1024 image
            original_image = Image.open(img)
            new_width, new_height = 1080, 1920
            # Create a new blank image with the desired dimensions and a black background
            new_image = Image.new('RGB', (new_width, new_height), (0, 0, 0))
            # Calculate the dimensions for the scaled image to fit the width
            scaled_width = new_width
            scaled_height = int(original_image.height * (new_width / original_image.width))

            # Calculate the position to center the scaled image vertically
            left = 0
            top = (new_height - scaled_height) // 2

            # Resize and paste the original image onto the new image
            resized_image = original_image.resize((scaled_width, scaled_height), resample=Image.LANCZOS)
            new_image.paste(resized_image, (left, top))

            # Save the resulting image with black borders
            new_image.save(img)

            # Close the images
            original_image.close()
            new_image.close()

    def resizeImagesToFitHeight(self):
        # Create the video from images
        for image in self.images:
            img = cv2.imread(os.path.join(self.image_folder, image))
            img_height, img_width, _ = img.shape
            img_aspect_ratio = img_width / img_height
            target_aspect_ratio = self.width / self.height
            
            if img_aspect_ratio > target_aspect_ratio:
                # Crop the sides to fit the target aspect ratio
                crop_width = int(img_height * target_aspect_ratio)
                start_x = (img_width - crop_width) // 2
                img = img[:, start_x:start_x + crop_width]
            else:
                # Crop the top and bottom to fit the target aspect ratio
                crop_height = int(img_width / target_aspect_ratio)
                start_y = (img_height - crop_height) // 2
                img = img[start_y:start_y + crop_height, :]

            # Resize the cropped image to the target dimensions
            img = cv2.resize(img, (self.width, self.height))
    
    def createVideo(self, secondsPerImage):
        image_files = [os.path.join(self.image_folder, img) for img in os.listdir(self.image_folder) if img.endswith(('jpg'))]
        clips = [ImageClip(img, duration=secondsPerImage) for img in image_files]
        video = concatenate_videoclips(clips, method="compose")
        video.write_videofile(self.video_name, fps=30, codec='libx264')


    # WARNING: BROKEN
    def createVideoWithZoom(self, secondsPerImage, zoom_factor):
        clips = []
        for filename in sorted(os.listdir(self.image_folder)):
            if filename.lower().endswith((".jpg", ".jpeg", ".png")):
                img_path = os.path.join(self.image_folder, filename)
                base_clip = ImageClip(img_path, duration=secondsPerImage)

                # no .fx apparently
                zoomed_clip = base_clip.fx(
                    ImageClip.resize,
                    lambda t: 1 + (zoom_factor - 1) * (t / secondsPerImage)
                )
                clips.append(zoomed_clip)

        final_clip = concatenate_videoclips(clips, method="compose")
        final_clip.write_videofile(self.video_name, fps=30)


    def addNumbersToImages(self):
        font = ImageFont.truetype("./Fonts/Archivo-Regular.ttf", 70)
        text_color = (255, 255, 255)  # RGB color tuple
        background_color = (0,0,0)
    
        i = 1
        for imageFile in self.images:
            image = Image.open(os.path.join(self.image_folder, imageFile))
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


    def addMusic(self, audioPath, start_time):
        audio_clip = AudioFileClip(audioPath)

        # Trim the audio clip to start from a specific time
        video_clip = VideoFileClip(self.video_name)
        audio_clip = AudioFileClip(audioPath).subclipped(start_time, start_time+video_clip.duration)

        # # Ensure the audio duration matches the video duration
        # if audio_clip.duration < video_clip.duration:
        #     audio_clip = audio_clip.crossfade(self.video.duration)

        # Set the audio of the video to the modified audio clip
        video_clip = video_clip.with_audio(audio_clip)

        # Write the final video to the output file
        video_clip.write_videofile(os.path.join(self.image_folder, "temp.mp4"), codec='libx264', audio_codec='aac', fps=30)
        # Replace old with new. There was a glitch if I ouput directly using the old video name.
        os.remove(self.video_name)
        os.rename(os.path.join(self.image_folder, "temp.mp4"), self.video_name)

        # Close the video and audio clips
        video_clip.close()
        audio_clip.close()

