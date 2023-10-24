import os
import openai
from dotenv import load_dotenv
load_dotenv()
import logging
from dalle3 import Dalle
import random

# Initialize the OpenAI API client
openai.api_key = os.getenv("OPENAI_API_KEY")



# Text to send as a prompt to the model
topics = [
  "Interior Design of a House",
  "Exterior Design of a House",
  "Design of a highway bridge",
  "Mansion Design",
  "Kitchen layout interior",
  "Living Room Interior Design"
]

themes = [
  """Dark, mysterious, warm light, dim, shimmer, shiny, marble, expensive, Minimalistic""",
  """Light, White, Gold, Shiny, Friendly, Approachable, marble, ambient, Sleek""",
  """Rustic, wood, forrestry, plants, natural light, nature, cozy, warm, earthy""",
  """Industrial, Brick, steel, concrete, urban, raw, rustic, machinery, grey, lightbulb""",
  """futuristic, digital, minimalist, cyberpunk, glass, shiny, LED Lighting""",
  """Contemporary, open concept, neutral colours, large, high, flow, shapes, straight edges"""
]

topic = random.choice(topics)
n = 1
for theme in themes:
  prompt = "Generate a detailed image generation prompt using the topic of " + topic + """ 
            and five of the following keywords: """ + theme + """. Keep the 
            description to 100 words or less."""
  # Make an API call to generate text
  response = openai.Completion.create(
      engine="text-davinci-003",  # Specify the GPT-3.5 engine
      prompt=prompt,
      max_tokens=100,  # Adjust the maximum number of tokens in the response as needed
      n = 1 # Number of responses to generate
  )
  # Extract the generated text
  image_prompt = response.choices[0].text
  
  # Generate Image.
  # Generate Image using DALLE3 Unofficial API.
  # Need Cookie. Find by going to the Bing Chat page, open dev tools (CMD + OPT + I).
  # Click on storage, scroll to _U, and copy the value. Paste on .env file.
  cookie = os.getenv("BING_COOKIE_VALUE")
  logging.basicConfig(level=logging.INFO)
  dalle = Dalle(cookie)
  print(image_prompt)
  dalle.create("Draw this: " + image_prompt)
  urls = dalle.get_urls()
  url = urls[:1] # Only save first choice.
  dalle.download(url, "./images")

  # Show progress.
  print("Image " + str(n) + "\n" + image_prompt)
  n = n + 1
